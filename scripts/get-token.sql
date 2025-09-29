-- Run this in your Neon database console to get the access token
-- Copy the access_token value and paste it into scripts/test-version-stack-hardcoded.ts

SELECT 
  user_id,
  account_id,
  email,
  name,
  access_token,
  expires_at,
  created_at
FROM user_tokens
ORDER BY updated_at DESC
LIMIT 1;
