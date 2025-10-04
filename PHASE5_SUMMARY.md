# Phase 5: Confidence-Based Matching & Production Testing

## Overview

Phase 5 focused on improving match accuracy through high-resolution perceptual hashing, confidence-based matching with temporal refinement, and addressing critical bugs discovered through production testing with real-world video content.

**Duration:** Completed October 4, 2025  
**Key Achievement:** 1024-bit hashing with confidence scoring + 3 critical production bug fixes  
**Status:** ✅ Deployed and tested on Railway

---

## Phase 5A: Advanced Matching Implementation

### 1. High-Resolution Perceptual Hashing

**Upgrade:** 64-bit → 1024-bit dHash

```typescript
// Before: 8x8 grid = 64 bits
const resized = await sharp(frameBuffer).resize(9, 8, { fit: 'fill' })

// After: 32x32 grid = 1024 bits
const resized = await sharp(frameBuffer).resize(33, 32, { fit: 'fill' })
```

**Impact:**
- **Memory:** 240KB → 3.8MB for 31K target hashes (acceptable)
- **Detail:** 16x more information per frame
- **Accuracy:** Better handling of motion blur, similar frames, re-encoding artifacts
- **Performance:** Still fast (~2-3ms per frame vs ~1ms)

**Updated Similarity Scale (1024-bit):**
- 0-80 bits: Nearly identical (~92%+ similar)
- 81-160 bits: Very similar (~84-92%)
- 161-320 bits: Similar (~69-84%)
- 321-400 bits: Moderately similar (~61-69%)
- 401+ bits: Different (<61%)

### 2. Confidence-Based Matching System

**New Architecture:**

```typescript
interface MatchResult {
  action: 'transfer' | 'skip' | 'needs_refinement';
  targetFrame?: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  reason: string;
  candidates?: Array<{ frame: number; distance: number }>;
}
```

**Three-Tier Decision System:**

1. **High Confidence** (50+ bit gap)
   - Clear winner, significant difference from 2nd place
   - Transfer immediately with ✓ mark
   - Example: `clear_winner (0.954 sim, 73 bit gap)`

2. **Needs Refinement** (2-15 close candidates)
   - Multiple similar frames within 50 bits
   - Extract temporal neighbors for disambiguation
   - Example: `needs_refinement (5 candidates within 50 bits)`

3. **Low Confidence** (15+ similar frames)
   - Genuinely ambiguous content (static shots, repeated frames)
   - Accept best match with ? mark
   - Example: `ambiguous_23_similar_frames (0.947 sim)`

4. **Skip** (>400 bits / <61% similarity)
   - No plausible match found
   - Shot likely deleted from edit
   - Example: `no_similar_frames_found (best: 0.58)`

### 3. Temporal Neighbor Refinement

**Algorithm:**
- Extract 5-frame window: `[-5, -1, 0, +1, +5]` frames (~0.2s @ 24fps)
- Score each candidate using temporal context
- Compare total Hamming distance across all 5 frames
- Award higher confidence if winner emerges

```typescript
function refineWithNeighbors(
  sourceNeighborHashes: FrameHash[],
  candidates: Array<{ frame: number; distance: number }>,
  targetHashes: FrameHash[]
): MatchResult
```

**Refinement Confidence Levels:**
- **High:** 200+ bit improvement (40+ bits/frame average)
- **Medium:** 80+ bit improvement (16+ bits/frame average)
- **Low:** <80 bit improvement (still ambiguous)

**Performance:**
- Batch extraction: All neighbor frames in one FFmpeg call
- Parallel hashing: Process multiple frames simultaneously
- Adds 30-60s for 20-30% of comments requiring refinement

---

## Phase 5B: Production Testing & Bug Fixes

### Testing Environment
- **Video:** 21-minute master with 42 comments
- **Platform:** Railway with 32 vCPU
- **Performance:** ~5 minutes total (3.5min video processing + rate limiting)
- **Result:** Revealed 3 critical bugs affecting accuracy

---

### Bug #1: Duplicate Job Processing ❌→✅

**Symptoms:**
- Job processed twice, creating duplicate comments
- Two different job IDs in logs: `bc93168b...` and `fd63c2bc...`
- All comments transferred 2x

**Root Cause:**
Frame.io webhooks implement automatic retries:
> "Frame.io expects a response in under 5 seconds and attempts to retry up to 5 times while waiting for a response."
> — [Adobe Developer Docs](https://developer.adobe.com/frameio/guides/Custom%20Actions/Configuring%20Actions/#interactions-retries-and-timeouts)

Our system:
1. Receives webhook
2. Returns form immediately (fast)
3. Receives form submission
4. Starts background job processing
5. **Returns success message immediately** ← Frame.io sees this as "complete"
6. **But if response slow or network glitch:** Frame.io retries
7. Each retry creates new job (no idempotency check)

**Solution:**
```typescript
// Check for existing job with same interaction_id
const existingJob = await db.query.processingJobs.findFirst({
  where: (jobs, { eq }) => eq(jobs.interactionId, payload.interaction_id!)
});

if (existingJob) {
  console.log(`⚠️  Job already exists for interaction ${payload.interaction_id}`);
  return {
    title: existingJob.status === 'completed' ? "Already Processed ✓" : "Processing... ⏳",
    description: existingJob.status === 'completed' 
      ? "This request has already been completed."
      : "Your request is already being processed. Please wait."
  };
}
```

**Key Insight:**
The `interaction_id` field exists specifically for idempotency:
> "The `interaction_id` is a unique identifier to track an Action's execution as it evolves over time. The ID persists throughout any sequence of an Action, including callback forms."

---

### Bug #2: Off-by-One Frame Error ❌→✅

**Symptoms:**
- Most "✓" (high confidence) comments were consistently 1 frame late
- Example: Comment at frame 456 placed at frame 457

**Root Cause:**
Double frame calculation with incorrect offset:

```typescript
// Bug in comment-transfer.ts:
const targetFrameNumber = Math.round(targetTimestamp * 24) + 1;  // ❌ WRONG!
```

**Three Issues:**
1. **Recalculating:** Frame number already calculated correctly in matching phase
2. **Adding +1:** Incorrectly applied "Frame.io 1-indexing" offset (already handled elsewhere)
3. **Hardcoded 24fps:** Should use actual video FPS from metadata

**Solution:**
```typescript
// Use the already-calculated frame number:
const frameNumber = match.targetFrameNumber;  // ✅ CORRECT!

const commentData = {
  text: commentText,
  timestamp: frameNumber,  // Direct use, no recalculation
};
```

The `targetFrameNumber` was already calculated correctly:
```typescript
// In frame-processor.ts:
const targetFrameNumber = Math.round(match.targetTimestamp * targetMetadata.fps);
```

**Key Insight:**
Trust the matching phase calculation. Don't recalculate timestamps in the transfer phase.

---

### Bug #3: Overly Conservative Confidence Thresholds ❌→✅

**Symptoms:**
- Comments marked with "?" (low confidence) had 94-97% similarity
- These "low confidence" matches were actually **bang-on accurate**
- Too many comments requiring unnecessary refinement

**Root Cause:**
Thresholds designed for 64-bit hashes didn't scale properly to 1024-bit hashes:
- Original: 80-bit gap for "high confidence"
- With 1024 bits: 80/1024 = 7.8% difference required
- Reality: Even 5% difference (50 bits) is highly significant

**Testing Insights:**
| Similarity | Old Confidence | Actual Accuracy | Should Be |
|------------|----------------|-----------------|-----------|
| 94-97% | Low (?) | Bang-on accurate | High (✓) |
| 92-94% | Medium (~) | Very accurate | High/Medium |
| <92% | Needs refinement | Sometimes accurate | Medium/Low |

**Solution:**
Updated thresholds based on empirical testing:

```typescript
// Initial Matching Thresholds
const CONFIDENCE_GAP = 50;           // Was 80 (5% vs 8%)
const CLOSE_MATCH_WINDOW = 50;       // Was 80
const AMBIGUOUS_THRESHOLD = 15;      // Was 20 frames
const NO_MATCH_THRESHOLD = 400;      // Unchanged (61% similarity)

// Refinement Thresholds
const REFINEMENT_HIGH = 200;         // Was 320 bits
const REFINEMENT_MEDIUM = 80;        // Was 160 bits
```

**Impact:**
- More matches classified as high confidence
- Fewer unnecessary refinements
- Confidence indicators now match observed accuracy

---

## Enhanced Logging System

### Per-Match Visibility

**Before:** Generic batch summaries  
**After:** Individual match decisions with reasoning

```
📊 Phase 3a: Confidence-Based Matching

✓  Match "Shot 1..." → frame 5 (95.4% sim, high)
✓  Match "Shot 2..." → frame 457 (94.4% sim, high)
~  Refine "Shot 3..." - needs_refinement (5 candidates within 50 bits)
?  Match "Shot 5..." → frame 1267 (94.7% sim, low)
⏭️  Skip "Shot 13..." - no_similar_frames_found (best: 0.58)

✓ 12 high/low-confidence matches
~ 16 need temporal refinement
⏭ 14 skipped (no match found)

📊 Phase 3b: Temporal Neighbor Refinement

  ✓ Refined "Shot 2..." → frame 457 (94.4% sim, high - refined_strong (245 bit gap))
  ~ Refined "Shot 10..." → frame 12867 (95.2% sim, medium - refined_moderate (124 bit gap))
  ? Refined "Shot 7..." → frame 8713 (95.3% sim, low - refined_weak (45 bit gap))

✅ Refinement complete: 28 total matches

📊 Final Matching Results:
   Total matched: 28
   High confidence: 20  (71%)
   Medium confidence: 6  (21%)
   Low confidence: 2     (7%)
   Skipped: 14          (33% of original 42)
```

**Features:**
- **Emoji indicators:** ✓ (high), ~ (medium), ? (low), ⏭️ (skip)
- **Similarity percentages** for each match
- **Reason codes** for debugging (e.g., `clear_winner`, `refined_strong`)
- **Per-match logging** (not per-frame during extraction)
- **Distribution summary** for quick analysis

---

## Testing Results Comparison

### Before Bug Fixes:
| Issue | Impact |
|-------|--------|
| Duplicate jobs | ❌ 2x comments transferred (56 instead of 28) |
| Off-by-one | ❌ Comments 1 frame late |
| Conservative thresholds | ⚠️ Too many "?" marks on accurate matches |

### After Bug Fixes:
| Metric | Result |
|--------|--------|
| Duplicate prevention | ✅ Single job per interaction |
| Frame accuracy | ✅ Comments on exact frames |
| Confidence distribution | ✅ 71% high, 21% medium, 7% low |
| Match accuracy | ✅ 94-97% similarity = reliable |
| Processing time | ✅ ~5 minutes (within target) |

**Breakdown:**
- **28 comments transferred** (of 42 source comments)
- **14 skipped** (shots deleted from edit: 56-59% similarity)
- **20 high confidence** (✓) - clear winners
- **6 medium confidence** (~) - refined with neighbors
- **2 low confidence** (?) - genuinely ambiguous (static shots)

---

## Performance Metrics

**Video Processing:**
- **Total time:** ~3.5 minutes for 21-minute video
- **Speed:** 6x realtime extraction and hashing
- **Target frames:** 31,195 frames @ 24fps
- **Source frames:** 42 frames (with -ss seeking)
- **Memory:** ~4MB for target hashes (1024-bit)

**Matching & Refinement:**
- **Initial matching:** ~1.5 minutes (31K comparisons × 42 comments)
- **Refinement:** 16 comments × 80 neighbor frames = ~30 seconds
- **Total matching:** ~2 minutes

**API Rate Limiting:**
- Frame.io limit: 10 calls/minute
- **Batches:** 3 batches (10 + 10 + 8 comments)
- **Wait time:** 2× 60s = 2 minutes between batches
- **Transfer time:** ~3 minutes total

**Overall:** 3.5min (video) + 2min (matching) + 3min (transfer) = **~8.5 minutes total**  
*(Includes rate limit waits, actual processing is ~5-6 minutes)*

---

## Architecture Improvements

### 1. Idempotency Pattern
```typescript
// Pattern for all webhook-triggered operations
const existingResource = await findByTransactionId(transactionId);
if (existingResource) {
  return cachedResponse(existingResource);
}
// Create new resource...
```

### 2. Trust the Pipeline
```typescript
// Anti-pattern: Recalculating derived values
const frameNumber = Math.round(timestamp * fps) + 1;  // ❌

// Better: Trust upstream calculations
const frameNumber = match.targetFrameNumber;  // ✅
```

### 3. Empirical Threshold Tuning
- Don't guess at thresholds
- Test with production data
- Adjust based on observed accuracy
- Document reasoning for future tuning

### 4. Observable Matching Decisions
- Log each match with reasoning
- Include confidence indicators
- Show similarity scores
- Track distribution for analysis

---

## Key Learnings

### 1. Webhook Retry Patterns
Frame.io (and most webhook systems) implement automatic retries. Always:
- Use transaction/interaction IDs for idempotency
- Return responses quickly (<5s)
- Handle duplicate requests gracefully
- Test retry scenarios

### 2. Frame Number Indexing
Different systems use different conventions:
- **FFmpeg:** 0-indexed frames
- **Frame.io API:** Frame numbers (check docs)
- **Timestamps:** Can be converted, but use actual FPS
- **Always:** Use single source of truth for calculations

### 3. Perceptual Hash Resolution Tradeoffs
- **64-bit:** Fast, low memory, good for duplicates
- **1024-bit:** Slower (2-3x), more memory (16x), **better for similar content**
- **Choice depends on:** Video content, accuracy requirements, resources

### 4. Confidence Thresholds Are Data-Dependent
- No universal "good" threshold
- Depends on: hash resolution, video type, re-encoding quality
- **Must test with production data**
- Conservative → more refinements → slower but safer
- Aggressive → fewer refinements → faster but riskier

### 5. Testing Reveals Truth
Production testing with real content revealed:
- System was more accurate than thresholds assumed
- 94-97% similarity = reliable matches
- Ambiguity mainly in static shots (genuinely similar frames)
- "? low confidence" matches were often perfect

---

## Production Readiness Checklist

### ✅ Completed
- [x] High-resolution perceptual hashing (1024-bit)
- [x] Confidence-based matching with temporal refinement
- [x] Idempotency handling for webhook retries
- [x] Frame-accurate comment placement
- [x] Empirically-tuned confidence thresholds
- [x] Per-match logging with reasoning
- [x] Streaming frame extraction (handles long videos)
- [x] Rate limit compliance (10 calls/min)
- [x] Background job processing
- [x] Error handling and recovery

### 🔄 Known Limitations
- ⚠️ Rate limiting adds 2+ minutes for large comment sets
- ⚠️ Processing time scales with video length (~6x realtime)
- ⚠️ No batch comment API (would eliminate rate limit delays)
- ⚠️ Static shots with similar frames may get low confidence
- ⚠️ Memory usage: ~4MB per 30min of video @ 24fps

### 🎯 Future Enhancements
- [ ] Parallel video processing (split video into chunks)
- [ ] Cache hashes for version stacks (avoid reprocessing)
- [ ] User-adjustable confidence thresholds
- [ ] Annotation transfer (drawings, shapes)
- [ ] Progress notifications (webhook back to Frame.io)
- [ ] Batch comment API support (when available)

---

## Files Modified

### Core Matching Logic
- **`src/lib/ai/perceptual-hash.ts`**
  - 64-bit → 1024-bit hash generation
  - `matchWithConfidence()` function
  - `refineWithNeighbors()` function
  - Empirically-tuned thresholds

### Processing Pipeline
- **`src/lib/video/frame-processor.ts`**
  - Confidence-based matching workflow
  - Temporal refinement phase
  - Per-match logging with emoji indicators
  - Distribution reporting

### Comment Transfer
- **`src/lib/video/comment-transfer.ts`**
  - Use `match.targetFrameNumber` directly
  - Add confidence emoji to comment text
  - Enhanced transfer logging

### Webhook Handler
- **`src/app/api/webhooks/frameio/route.ts`**
  - Idempotency check using `interaction_id`
  - Duplicate job prevention
  - Status-aware response messages

---

## Testing Recommendations

### Test Scenarios
1. **Happy Path:** Clean edit, most shots present
2. **Deleted Shots:** Source comments on removed content
3. **Static Shots:** Low motion, similar adjacent frames
4. **Fast Motion:** Camera movement, action sequences
5. **Re-encoding:** Different codecs, quality settings
6. **Webhook Retries:** Simulate slow responses
7. **Large Comment Sets:** 100+ comments (rate limiting)

### Validation Checklist
- [ ] No duplicate comments created
- [ ] Comments on correct frames (not ±1)
- [ ] Confidence marks match visual inspection
- [ ] High confidence (✓) = obviously correct
- [ ] Medium confidence (~) = reasonable after refinement
- [ ] Low confidence (?) = genuinely ambiguous
- [ ] Skipped (⏭️) = shot not in target
- [ ] Processing completes without errors
- [ ] Logs show clear decision reasoning

---

## Conclusion

Phase 5 successfully implemented advanced matching with confidence scoring and resolved critical production bugs. The system now:

- **Accurately matches** frames using 1024-bit perceptual hashing
- **Intelligently decides** when to refine uncertain matches
- **Prevents duplicates** through idempotency checks
- **Places comments precisely** without off-by-one errors
- **Assigns confidence** that reflects actual accuracy
- **Provides visibility** into matching decisions

**Ready for production deployment** with known limitations documented and future enhancements identified.

**Performance:** ~5-8 minutes for 20-minute videos with 40+ comments  
**Accuracy:** 94-97% similarity matches are frame-perfect  
**Confidence Distribution:** 71% high, 21% medium, 7% low (8% skipped)

The system is now mature enough for real-world usage while maintaining clear paths for future optimization.

