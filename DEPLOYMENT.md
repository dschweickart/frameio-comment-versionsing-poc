# Vercel Deployment with Automated Neon Database Setup

This guide shows how to deploy the Frame.io Comment Versioning POC to Vercel with automatic Neon database creation and setup.

## 🚀 One-Click Deployment

### Option 1: Deploy from GitHub (Recommended)

1. **Create GitHub Repository**:
   - Go to [GitHub](https://github.com) and create a new repository named `frameio-comment-versionsing-poc`
   - Make it public for easier Vercel integration

2. **Push Code**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/frameio-comment-versionsing-poc.git
   git push -u origin main
   ```

3. **Deploy to Vercel**:
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "New Project"
   - Import your GitHub repository
   - Vercel will automatically detect it's a Next.js project

4. **Add Neon Integration**:
   - In the deployment configuration, go to "Integrations"
   - Add "Neon" integration
   - This will automatically create a PostgreSQL database and set environment variables

5. **Deploy**:
   - Click "Deploy"
   - Vercel will build and deploy your app
   - The `postbuild` script will automatically set up the database schema

### Option 2: Deploy with Vercel CLI

1. **Install Vercel CLI**:
   ```bash
   npm i -g vercel
   ```

2. **Login and Deploy**:
   ```bash
   vercel login
   vercel --prod
   ```

3. **Add Neon Integration**:
   - Go to your project dashboard on vercel.com
   - Add Neon integration from the Integrations tab

## 🔧 Environment Variables

When you add the Neon integration, these variables are automatically set:
- `DATABASE_URL` - Main connection string
- `POSTGRES_URL` - Alias for DATABASE_URL
- `POSTGRES_PRISMA_URL` - Prisma-compatible URL
- `POSTGRES_URL_NON_POOLING` - Direct connection URL

### Additional Variables to Set

Add these in your Vercel project settings:

```bash
# Frame.io API (get from Frame.io Developer Console)
FRAMEIO_CLIENT_ID=your_client_id
FRAMEIO_CLIENT_SECRET=your_client_secret  
FRAMEIO_WEBHOOK_SECRET=your_webhook_secret

# AI Services
OPENAI_API_KEY=your_openai_key

# Application
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

## 🏗️ Automatic Database Setup

The deployment process automatically:

1. **Creates Neon Database**: Via Vercel integration
2. **Enables pgvector**: Extension for vector similarity search
3. **Creates Tables**: All required tables with proper schema
4. **Sets Up Indexes**: Vector similarity and performance indexes
5. **Verifies Setup**: Confirms everything is working

### Database Setup Process

1. **Build Phase**: Next.js app builds successfully
2. **Post-Build**: `scripts/setup-database.js` runs automatically
3. **Schema Creation**: Executes `src/lib/db/migrations/001_initial_setup.sql`
4. **Verification**: Confirms tables and extensions are created

## ✅ Verify Deployment

After deployment completes:

1. **Check Health Endpoint**:
   ```bash
   curl https://your-app.vercel.app/api/health
   ```

   Should return:
   ```json
   {
     "status": "healthy",
     "database": {
       "connected": true,
       "pgvector": true,
       "tables": ["comments", "frames", "processing_jobs", "videos"],
       "tablesCount": 4
     }
   }
   ```

2. **Check Vercel Logs**:
   - Go to your project dashboard
   - Check "Functions" tab for any errors
   - Look for database setup logs in the build output

3. **Test Database Connection**:
   - Use Vercel's built-in terminal or
   - Connect to your Neon database directly

## 🔍 Troubleshooting

### Common Issues

1. **Build Fails**:
   - Check that all dependencies are in `package.json`
   - Verify TypeScript compilation errors

2. **Database Setup Fails**:
   - Check Vercel function logs
   - Verify Neon integration is properly connected
   - Ensure `DATABASE_URL` is set

3. **pgvector Extension Missing**:
   - Some Neon plans don't support extensions
   - Upgrade to a plan that supports pgvector

4. **Environment Variables**:
   - Double-check all required variables are set
   - Redeploy after adding new variables

### Debug Commands

```bash
# Check deployment status
vercel ls

# View logs
vercel logs your-deployment-url

# Check environment variables
vercel env ls
```

## 🎯 Next Steps

Once deployed successfully:

1. **Configure Frame.io**:
   - Set up custom actions pointing to your Vercel URL
   - Test webhook endpoints

2. **Add Authentication**:
   - Implement Frame.io OAuth flow
   - Set up user session management

3. **Test Video Processing**:
   - Upload test videos
   - Verify comment transfer workflow

## 📊 Monitoring

- **Vercel Analytics**: Built-in performance monitoring
- **Database Metrics**: Available in Neon dashboard  
- **Function Logs**: Real-time logs in Vercel dashboard
- **Health Checks**: Use `/api/health` endpoint for monitoring

The deployment is now ready for Phase 2 development!
