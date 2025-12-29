#!/usr/bin/env bash

# setup_secrets.sh
# Script to manage application secrets stored in AWS Secrets Manager.
# This script UPDATES the SecretString of a pre-existing secret container
# created by Terraform. It does NOT create the container itself.
# Requires AWS CLI and jq.

# Exit immediately if a command exits with a non-zero status.
set -euo pipefail

if [ -z "$BASH_VERSION" ]; then
  echo "Error: This script requires Bash to run."
  echo "Please execute it using 'bash setup_secrets.sh' or ensure your /bin/sh points to bash."
  exit 1
fi

# --- Configuration ---
# These should match the naming conventions used in your Terraform code
PROJECT_NAME="auxx" # Matches var.project_name default in your Terraform
SECRET_NAME_SUFFIX="-app-secrets" # Matches local.secret_name in infra/modules/secrets

# List of application secret keys that this script will manage within the JSON string.
# These MUST match the keys expected by your application code (e.g., process.env.DB_PASSWORD)
# and the keys referenced in the ECS Task Definition's `valueFrom` parameters.
# Add or remove keys as needed.
APP_SECRET_KEYS=(
  "DB_HOST"
  "DB_PORT"
  "DB_NAME"
  "DB_USERNAME"
  "DB_PASSWORD"
  "REDIS_HOST"
  "REDIS_PORT"
  "BETTER_AUTH_SECRET"
  "API_KEY_SALT"
  "AUTH_GITHUB_ID"
  "AUTH_GITHUB_SECRET"
  "AUTH_GOOGLE_ID"
  "AUTH_GOOGLE_SECRET"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" # Include even if public, if managed via SM
  "GOOGLE_CLIENT_ID"
  "GOOGLE_CLIENT_SECRET"
  "GOOGLE_PROJECT_ID" # Include if needed explicitly in secret string
  "GOOGLE_PUBSUB_TOPIC" # Include if needed explicitly in secret string
  "GOOGLE_PUBSUB_SUBSCRIPTION" # Include if needed explicitly in secret string
  "GOOGLE_CLIENT_EMAIL"
  "GOOGLE_PRIVATE_KEY"
  "GOOGLE_PUBSUB_VERIFICATION_TOKEN"
  "SHOPIFY_API_KEY"
  "SHOPIFY_API_SECRET"
  "OUTLOOK_CLIENT_ID"
  "OUTLOOK_CLIENT_SECRET"
  "OUTLOOK_WEBHOOK_SECRET"
  "FACEBOOK_APP_ID"
  "FACEBOOK_APP_SECRET"
  # "FACEBOOK_GRAPH_API_VERSION" # Include if needed explicitly in secret string
  "FACEBOOK_WEBHOOK_VERIFY_TOKEN"
  "MAILGUN_API_KEY"
  "MAILGUN_DOMAIN"
  "OPENAI_API_KEY"
  "OPENAI_MODEL" # Include if needed explicitly in secret string
  "BEDROCK_ACCESS_KEY"
  "BEDROCK_SECRET_KEY"
  "ANTHROPIC_MODEL" # Include if needed explicitly in secret string
  "ANTHROPIC_API_KEY"
  "GOOGLE_API_KEY" # Assuming this is the AI models one (from your variable list)
  "GROQ_API_KEY"
  "PUSHER_APP_ID" # Include if needed explicitly in secret string
  "PUSHER_KEY" # Include if needed explicitly in secret string
  "PUSHER_SECRET"
  "PUSHER_CLUSTER" # Include if needed explicitly in secret string
  "POSTHOG_KEY" # Include if Posthog key is sensitive and stored in SM
  # Add any other application environment variables that contain secrets or config you want in SM
)

# --- Helper functions for working with parallel arrays instead of associative arrays ---
# Initialize empty arrays for keys and values
secret_keys=()
secret_values=()

# Function to add or update a key-value pair
add_secret() {
  local key="$1"
  local value="$2"
  local i
  
  # Check if key already exists
  for i in ${!secret_keys[@]}; do
    if [ "${secret_keys[$i]}" = "$key" ]; then
      # Update existing key
      secret_values[$i]="$value"
      return
    fi
  done
  
  # Add new key
  secret_keys+=("$key")
  secret_values+=("$value")
}

# Function to check if key exists
has_secret() {
  local key="$1"
  local i
  
  for i in ${!secret_keys[@]}; do
    if [ "${secret_keys[$i]}" = "$key" ]; then
      return 0
    fi
  done
  
  return 1
}

# Function to get the count of secrets
secret_count() {
  echo ${#secret_keys[@]}
}

# --- Usage ---
usage() {
  echo "Usage: $0 <environment> [--env-file <file>]"
  echo ""
  echo "  <environment> : The target environment (dev, staging, prod). This determines the secret name."
  echo "  --env-file <file> : Optional. Path to a .env file to load secrets from."
  echo "                    Values from the command line environment will override"
  echo "                    values from the .env file."
  echo ""
  echo "This script UPDATES the SecretString of the AWS Secrets Manager secret"
  echo "container named '${PROJECT_NAME}-<environment>${SECRET_NAME_SUFFIX}'."
  echo "The container must be created by Terraform first."
  echo ""
  echo "Secrets are read from environment variables matching the list:"
  echo " ${APP_SECRET_KEYS[*]}"
  echo ""
  echo "Example: DB_PASSWORD=mypassword $0 dev"
  echo "Example: $0 staging --env-file .env.staging"
  exit 1
}

# --- Main Script ---

# Parse arguments
ENV_FILE=""
ENVIRONMENT=""
while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    --env-file)
      if [[ -z "$2" ]]; then
        echo "Error: --env-file requires a file path."
        usage
      fi
      ENV_FILE="$2"
      shift # past argument
      shift # past value
      ;;
    *) # Environment argument
      if [[ -z "$ENVIRONMENT" ]]; then
        ENVIRONMENT="$1"
        shift # past argument
      else
        echo "Error: Too many arguments. Environment already specified."
        usage
      fi
      ;;
  esac
done

# Validate environment
if [[ -z "$ENVIRONMENT" ]]; then
  echo "Error: Environment not specified."
  usage
fi

if [[ ! " dev staging prod " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment '${ENVIRONMENT}'. Must be dev, staging, or prod."
  exit 1
fi

# Validate AWS Region is set
if [[ -z "${AWS_REGION:-}" ]]; then
    echo "Error: AWS_REGION environment variable is not set."
    echo "Please set AWS_REGION before running this script (e.g., export AWS_REGION=us-west-2)."
    exit 1
fi

# --- Load secrets from .env file if specified ---
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env file not found at '$ENV_FILE'."
    exit 1
  fi
  echo "Loading secrets from .env file: $ENV_FILE"
  
  # Create a temporary file for grep output to avoid issues with piping and while loops
  tmp_env=$(mktemp)
  grep -vE '^\s*#|^$' "$ENV_FILE" | sed 's/^\s*export //i' > "$tmp_env"
  
  while IFS='=' read -r key value; do
    # Trim whitespace and quotes from key
    key=$(echo "$key" | xargs)
    
    # Basic handling for values with spaces or quotes
    # This removes surrounding quotes if present
    value=$(echo "$value" | sed 's/^"\(.*\)"$/\1/' | sed "s/^'\(.*\)'$/\1/" | xargs)
    
    # Check if the key is in our list of app secrets
    for secret_key in "${APP_SECRET_KEYS[@]}"; do
      if [[ "$key" == "$secret_key" ]]; then
        add_secret "$key" "$value"
        # echo " Loaded $key from .env file." # Enable for verbose loading
        break # Found in list, move to next line
      fi
    done
  done < "$tmp_env"
  
  rm -f "$tmp_env"
fi

# --- Load secrets from environment variables (override .env) ---
echo "Checking for secrets in environment variables..."
for secret_key in "${APP_SECRET_KEYS[@]}"; do
  # Check if the environment variable is set and non-empty
  # We use eval to dynamically access variable by name in a POSIX-compliant way
  eval val=\${$secret_key:-}
  if [[ -n "$val" ]]; then
    add_secret "$secret_key" "$val"
    echo " Found $secret_key in environment variables (overrides .env file)."
  fi
done

# --- Get the Secrets Manager secret ID ---
SECRET_ID="${PROJECT_NAME}-${ENVIRONMENT}${SECRET_NAME_SUFFIX}"
echo ""
echo "Target Secrets Manager Secret: ${SECRET_ID} in ${AWS_REGION}"

# --- Get the current secret value from Secrets Manager ---
# We need the current value to perform a merge, preserving keys not provided as input.
echo "Attempting to retrieve current secret value from Secrets Manager..."
current_secret_json=""
if current_secret_output=$(aws secretsmanager get-secret-value --secret-id "${SECRET_ID}" --region "${AWS_REGION}" 2>&1); then
  # Secret exists, extract SecretString
  current_secret_json=$(echo "${current_secret_output}" | jq -r '.SecretString')
  echo "Successfully retrieved current secret value."

  # Check if the SecretString is valid JSON
  if ! echo "${current_secret_json}" | jq -e . > /dev/null 2>&1; then
      echo "Warning: Current secret value is not valid JSON. It will be replaced if new secrets are provided and merged."
      # If the existing secret value is not valid JSON, we can't merge.
      # We treat it as empty JSON if we have new input secrets to set.
      # If no new inputs, we'll exit later.
      if [ "$(secret_count)" -gt 0 ]; then
         current_secret_json="{}" # Treat as empty JSON for merging
      fi
  fi
else
  # Handle cases where the secret does not exist or other errors
  error_message=$(echo "${current_secret_output}" | jq -r '.Message // .errorMessage // .' 2>/dev/null || echo "${current_secret_output}")
  if echo "${error_message}" | grep -q "ResourceNotFoundException"; then
    echo "Error: Secrets Manager secret container '${SECRET_ID}' not found."
    echo "Please run 'terraform apply' for the '${ENVIRONMENT}' environment first to create the secret container."
    exit 1 # Exit because the container must exist for this script to function
  else
    echo "Error retrieving secret '${SECRET_ID}': ${error_message}"
    exit 1 # Exit on other AWS errors
  fi
fi

# --- If no new inputs, and we successfully read the secret, just exit ---
if [ "$(secret_count)" -eq 0 ]; then
  echo "No new secret values provided. Script finished after reading current secret."
  exit 0
fi

# --- Merge new secrets with current secrets ---
echo "Merging provided secrets with current values..."

# Method 1: Use shell to build jq filter (original approach)
jq_filter=""
for i in ${!secret_keys[@]}; do
  key="${secret_keys[$i]}"
  value="${secret_values[$i]}"
  
  # Escape quotes and backslashes in value for JSON string
  escaped_value=$(echo "$value" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
  
  # Add update expression for this key
  if [[ -z "$jq_filter" ]]; then
    jq_filter=".${key}=\"${escaped_value}\""
  else
    jq_filter="${jq_filter} | .${key}=\"${escaped_value}\""
  fi
done

# Method 2: Use jq's --arg approach which is safer for complex values
# Create a temporary file for jq to avoid command line length issues
tmp_json=$(mktemp)
echo "${current_secret_json}" > "$tmp_json"

for i in ${!secret_keys[@]}; do
  key="${secret_keys[$i]}"
  value="${secret_values[$i]}"
  
  # Use jq --arg to safely pass the value to jq
  current_secret_json=$(jq --arg key "$key" --arg value "$value" '.[$key] = $value' "$tmp_json")
  echo "${current_secret_json}" > "$tmp_json" # Update for next iteration
done

# Read the final merged JSON
merged_secret_json=$(cat "$tmp_json")
rm -f "$tmp_json"

echo "Merge complete."

# Validate the final merged JSON
if ! echo "${merged_secret_json}" | jq -e . > /dev/null; then
    echo "Error: Failed to produce valid JSON after merging."
    echo "Generated JSON: ${merged_secret_json}"
    exit 1
fi

# --- Put the merged secret value back into Secrets Manager ---
echo "Updating secret value in Secrets Manager..."

# Create a temporary file for the merged JSON to avoid command line length issues
tmp_json=$(mktemp)
echo "${merged_secret_json}" > "$tmp_json"

if aws secretsmanager put-secret-value --secret-id "${SECRET_ID}" --secret-string "file://${tmp_json}" --region "${AWS_REGION}" > /dev/null; then
  echo "Successfully updated secret '${SECRET_ID}'."
  echo "Note: This updates the secret value in AWS Secrets Manager."
  echo "To trigger a deployment of your application/Lambda using the new value,"
  echo "you need to trigger your CI/CD pipeline (e.g., 'deploy-terraform.yml')."
  rm -f "$tmp_json"
  exit 0
else
  echo "Error updating secret '${SECRET_ID}'."
  rm -f "$tmp_json"
  exit 1
fi