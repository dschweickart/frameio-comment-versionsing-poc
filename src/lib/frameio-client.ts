import { getSession } from '@/lib/auth/crypto';
import { refreshAccessToken } from '@/lib/auth/oauth';
import { getUserTokensByAccountId, saveUserTokens, isTokenExpired } from '@/lib/auth/token-storage';

// Frame.io API response types
export interface FrameioUser {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  [key: string]: unknown;
}

export interface FrameioProject {
  id: string;
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface FrameioAsset {
  id: string;
  name: string;
  type: string;
  parent_id?: string;
  project_id: string;
  [key: string]: unknown;
}

export interface FrameioComment {
  id: string;
  text: string;
  timestamp?: number;
  x?: number;
  y?: number;
  asset_id: string;
  [key: string]: unknown;
}

export interface FrameioFile {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'version_stack';
  parent_id?: string;
  project_id?: string;
  status?: string; // 'transcoded', 'uploaded', etc.
  file_size?: number; // API returns file_size (underscore)
  filesize?: number; // Legacy property
  media_type?: string;
  media_links?: {
    video_h264_720?: string;
    [key: string]: unknown;
  };
  fps?: number;
  duration?: number;
  [key: string]: unknown;
}

export interface FrameioVersionStack {
  id: string;
  name: string;
  type: 'version_stack';
  parent_id: string;
  project_id: string;
  version_count?: number;
  latest_version_id?: string;
  [key: string]: unknown;
}

interface ApiResponse<T = unknown> {
  [key: string]: T;
}

export class FrameioClient {
  private accessToken: string;
  private refreshToken: string;
  private expiresAt: number;

  constructor(accessToken: string, refreshToken: string, expiresAt: number) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
  }

  // Create client from session
  static async fromSession(): Promise<FrameioClient | null> {
    const session = await getSession();
    if (!session) return null;

    const expiresAt = session.tokens.obtained_at + (session.tokens.expires_in * 1000);
    
    return new FrameioClient(
      session.tokens.access_token,
      session.tokens.refresh_token,
      expiresAt
    );
  }

  // Create client from database tokens (for server-side operations)
  static async fromAccountId(accountId: string): Promise<FrameioClient | null> {
    const userToken = await getUserTokensByAccountId(accountId);
    if (!userToken) {
      console.error('No tokens found for account:', accountId);
      return null;
    }

    // Check if token needs refresh
    if (isTokenExpired(userToken.expiresAt)) {
      try {
        // Refresh the token
        const newTokens = await refreshAccessToken(userToken.refreshToken);
        
        // Save refreshed tokens back to database
        await saveUserTokens(
          userToken.userId,
          newTokens,
          {
            accountId: userToken.accountId || undefined,
            email: userToken.email || undefined,
            name: userToken.name || undefined,
          }
        );

        const newExpiresAt = newTokens.obtained_at + (newTokens.expires_in * 1000);
        return new FrameioClient(
          newTokens.access_token,
          newTokens.refresh_token,
          newExpiresAt
        );
      } catch (error) {
        console.error('Failed to refresh token for account:', accountId, error);
        return null;
      }
    }

    return new FrameioClient(
      userToken.accessToken,
      userToken.refreshToken,
      userToken.expiresAt.getTime()
    );
  }

  // Ensure token is valid, refresh if needed
  private async ensureValidToken(): Promise<void> {
    const now = Date.now();
    const refreshThreshold = 60000; // Refresh 1 minute before expiry

    if (now >= (this.expiresAt - refreshThreshold)) {
      try {
        const newTokens = await refreshAccessToken(this.refreshToken);
        this.accessToken = newTokens.access_token;
        this.refreshToken = newTokens.refresh_token;
        this.expiresAt = newTokens.obtained_at + (newTokens.expires_in * 1000);
      } catch (error) {
        console.error('Token refresh failed:', error);
        throw new Error('Authentication expired. Please sign in again.');
      }
    }
  }

  // Make authenticated API request
  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    await this.ensureValidToken();

    const url = `${process.env.FRAMEIO_API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || `HTTP ${response.status}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }

      throw new Error(`Frame.io API error: ${errorMessage}`);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return {} as T;
    }

    return response.json();
  }

  // User and Account methods
  async getCurrentUser(): Promise<FrameioUser> {
    return this.apiRequest('/me');
  }

  async getAccounts(): Promise<ApiResponse[]> {
    return this.apiRequest('/accounts');
  }

  // Project methods
  async getProjects(accountId: string): Promise<FrameioProject[]> {
    return this.apiRequest(`/accounts/${accountId}/projects`);
  }

  async getProject(accountId: string, projectId: string): Promise<FrameioProject> {
    return this.apiRequest(`/accounts/${accountId}/projects/${projectId}`);
  }

  // Asset methods
  async getAssets(projectId: string, parentAssetId?: string): Promise<FrameioAsset[]> {
    const endpoint = parentAssetId 
      ? `/projects/${projectId}/assets/${parentAssetId}/children`
      : `/projects/${projectId}/assets`;
    return this.apiRequest(endpoint);
  }

  async getAsset(assetId: string): Promise<FrameioAsset> {
    return this.apiRequest(`/assets/${assetId}`);
  }

  async getAssetChildren(assetId: string): Promise<FrameioAsset[]> {
    return this.apiRequest(`/assets/${assetId}/children`);
  }

  // File methods (V4 API)
  async getFile(accountId: string, fileId: string): Promise<FrameioFile> {
    const response = await this.apiRequest<{ data: FrameioFile }>(`/accounts/${accountId}/files/${fileId}`);
    return response.data;
  }

  // Version Stack methods (V4 API - Stable)
  async getVersionStack(accountId: string, versionStackId: string): Promise<FrameioVersionStack> {
    const response = await this.apiRequest<{ data: FrameioVersionStack }>(`/accounts/${accountId}/version_stacks/${versionStackId}`);
    return response.data;
  }

  async listVersionStackChildren(accountId: string, versionStackId: string): Promise<FrameioFile[]> {
    const response = await this.apiRequest<{ data: FrameioFile[] }>(
      `/accounts/${accountId}/version_stacks/${versionStackId}/children`
    );
    return response.data || [];
  }

  async createVersionStack(accountId: string, folderId: string, data: {
    name: string;
    description?: string;
  }): Promise<FrameioVersionStack> {
    return this.apiRequest(`/accounts/${accountId}/folders/${folderId}/version_stacks`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Comment methods
  async getComments(assetId: string): Promise<FrameioComment[]> {
    return this.apiRequest(`/assets/${assetId}/comments`);
  }

  async createComment(assetId: string, commentData: {
    text: string;
    timestamp?: number;
    page?: number;
    annotation?: unknown;
  }): Promise<FrameioComment> {
    return this.apiRequest(`/assets/${assetId}/comments`, {
      method: 'POST',
      body: JSON.stringify(commentData)
    });
  }

  async updateComment(commentId: string, commentData: {
    text?: string;
    timestamp?: number;
    page?: number;
  }): Promise<FrameioComment> {
    return this.apiRequest(`/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify(commentData)
    });
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.apiRequest(`/comments/${commentId}`, {
      method: 'DELETE'
    });
  }

  // File upload methods
  async createAsset(parentAssetId: string, assetData: {
    name: string;
    type: 'file' | 'folder';
    filetype?: string;
    filesize?: number;
  }): Promise<FrameioAsset> {
    return this.apiRequest(`/assets/${parentAssetId}/children`, {
      method: 'POST',
      body: JSON.stringify(assetData)
    });
  }

  // Webhook methods
  async getWebhooks(accountId: string): Promise<ApiResponse[]> {
    return this.apiRequest(`/accounts/${accountId}/webhooks`);
  }

  async createWebhook(accountId: string, webhookData: {
    url: string;
    events: string[];
    name?: string;
    secret?: string;
  }): Promise<ApiResponse> {
    return this.apiRequest(`/accounts/${accountId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(webhookData)
    });
  }

  async updateWebhook(accountId: string, webhookId: string, webhookData: {
    url?: string;
    events?: string[];
    active?: boolean;
  }): Promise<ApiResponse> {
    return this.apiRequest(`/accounts/${accountId}/webhooks/${webhookId}`, {
      method: 'PATCH',
      body: JSON.stringify(webhookData)
    });
  }

  async deleteWebhook(accountId: string, webhookId: string): Promise<void> {
    await this.apiRequest(`/accounts/${accountId}/webhooks/${webhookId}`, {
      method: 'DELETE'
    });
  }

  // Team and collaboration methods
  async getTeamMembers(accountId: string): Promise<ApiResponse[]> {
    return this.apiRequest(`/accounts/${accountId}/members`);
  }

  async getProjectCollaborators(projectId: string): Promise<ApiResponse[]> {
    return this.apiRequest(`/projects/${projectId}/collaborators`);
  }

  // Search methods
  async searchAssets(query: string, accountId?: string): Promise<FrameioAsset[]> {
    const params = new URLSearchParams({ q: query });
    if (accountId) params.append('account_id', accountId);
    
    return this.apiRequest(`/search/assets?${params.toString()}`);
  }

  // Utility methods
  async downloadAsset(assetId: string): Promise<Blob> {
    await this.ensureValidToken();

    const response = await fetch(`${process.env.FRAMEIO_API_BASE_URL}/assets/${assetId}/download`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download asset: HTTP ${response.status}`);
    }

    return response.blob();
  }

  // Rate limiting helper
  private async withRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        // Wait 1 second and retry once
        await new Promise(resolve => setTimeout(resolve, 1000));
        return operation();
      }
      throw error;
    }
  }

  // Batch operations with rate limiting
  async batchCreateComments(assetId: string, comments: Array<{
    text: string;
    timestamp?: number;
    page?: number;
  }>): Promise<Array<FrameioComment | { error: string }>> {
    const results = [];
    
    for (const comment of comments) {
      try {
        const result = await this.withRateLimit(() => 
          this.createComment(assetId, comment)
        );
        results.push(result);
        
        // Small delay between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to create comment:', error);
        results.push({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return results;
  }
}
