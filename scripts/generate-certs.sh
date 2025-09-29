#!/bin/bash

# Generate self-signed SSL certificates for localhost development
# Required for Adobe OAuth which mandates HTTPS even for localhost

echo "Generating SSL certificates for localhost development..."

# Create the scripts directory if it doesn't exist
mkdir -p scripts

# Generate private key
openssl genrsa -out scripts/localhost-key.pem 2048

# Generate certificate signing request
openssl req -new -key scripts/localhost-key.pem -out scripts/localhost.csr -subj "/C=US/ST=CA/L=San Francisco/O=Development/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -in scripts/localhost.csr -signkey scripts/localhost-key.pem -out scripts/localhost.pem -days 365 -extensions v3_req -extfile <(cat <<EOF
[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF
)

# Clean up CSR file
rm scripts/localhost.csr

echo "SSL certificates generated successfully!"
echo "- Private key: scripts/localhost-key.pem"
echo "- Certificate: scripts/localhost.pem"
echo ""
echo "⚠️  You may need to accept the self-signed certificate in your browser"
echo "   when accessing https://localhost:3000"
