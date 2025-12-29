# IAM Permissions

# IAM User

**IAM (Identity and Access Management) User** is an entity within your AWS account that represents a person or a service that interacts with AWS resources.

## Why create an IAM user for auto deployments?

For automation like deploying from GitHub/GitLab to AWS the best practice is to create a dedicated IAM User and assign it least-privilege access required just for that job.

---

# Creating an IAM User

- **Login to AWS Console** → Go to **IAM**
- **Users** → Click `Add users`
- Enter **User name**: **`git-deployer`**
- Choose **`Attach policies directly`** and
  - **`AmazonEC2ContainerRegistryPowerUser`** - Grants permissions to **push/pull Docker images** to/from Amazon ECR.
  - **`AmazonECS_FullAccess`** - Full control to interact with **Amazon ECS** (Elastic Container Service) – required for updating services, tasks, clusters.
  - **`IAMReadOnlyAccess`** - Useful for referencing roles or checking permissions.
- Click **`Next`**
- Review the new user and click **`Create user`**

# Generating Access Keys

AWS uses access keys to authenticate CLI and API requests. In a CI/CD pipeline, these keys allow GitHub Actions or GitLab CI to interact with AWS services securely for tasks like deployments.

Once the user is created:

1. Go to the user **`git-deployer`** → Scroll to **`Access keys`** section.
2. Under **`Access keys`** → Click **`reate access key`.**
3. Save the **`Access key ID`**and **`Secret access key`** (you will use them in GitHub/GitLab secrets)

# Setting Up Dockerfile

# **Dockerfile**

A **Dockerfile** is like a recipe for the app’s environment. It’s a script that tells Docker how to build a custom image. By automating this setup, it ensures that the app runs consistently everywhere.

### **`Dockerfile` Breakdown**

```docker
# Base image
FROM node:22-alpine
```

- **Purpose**: Sets the starting point of the image using a lightweight Node.js 22 Alpine base.

### **Node vs Node:Alpine**

- `node`: The full Node.js image, built on Debian. It’s packed with tools but bulky
- `node:22-alpine`: A smaller version based on Alpine Linux. It’s faster to download, uses less disk space, and has a smaller attack surface for better security.

<aside>
💡

**Why use Alpine?**

Smaller images means faster builds and deployments. Also, fewer pre-installed packages mean fewer security risks.

Rare compatibility issues with native packages can come up, but they’re usually very rare.

</aside>

# Set working directory

WORKDIR /app

- **What it does?**: Creates and sets `/app` as the working directory for all future commands in the container.
- **Why?**: Keeps your files organized and avoids cluttering the container’s root directory.

# Set environment to production

ENV NODE_ENV=production

- **What it does?**: Sets the `NODE_ENV` variable to production, enabling optimizations like skipping dev dependencies.
- **Why?**: Ensures the build avoids unnecessary dev tools or verbose logging.

# Install dependencies

COPY package\*.json ./
RUN npm install

- **What it does?**: Copies `package.json` and `package-lock.json`, then runs npm install to fetch dependencies.
- **Why?**: Isolating this step lets Docker cache the dependency layer. If only your code changes, Docker skips reinstalling dependencies, speeding up builds.

# Copy app files

COPY . .

- **What it does?**: Copies all your project files (code, configs, etc.) into the `/app` directory.
- **Why?**: Gets your app’s source code into the container so it can run.

# Expose the app port

EXPOSE 3001

- **What it does?**: Signals that the container listens on port `3001`.
- **Why?**: It’s like a heads-up to Docker and other tools about the port your app uses.

# Command to run the app

CMD ["node", "src/index.js"]

```bash
# Base image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app files
COPY . .

# Expose the app port
EXPOSE 3001

# Command to run the app
CMD ["node", "src/index.js"]
```

# Configuring GitHub

In this lesson we will go through how to configure GitHub to securely handle AWS deployments via GitHub Actions, including secret management and workflow triggers.

# Environment Variables

We use environment variables to securely connect your CI/CD pipeline with AWS and configure deployment environments (production and development). This avoids hardcoding values in your workflows and keeps credentials safe.

## Create New Variables

1. Navigate to **`Settings`** → **`Secrets and variables`** → **`Actions`**
2. Use the **`Secrets`** tab to add **sensitive variables**
3. Use the **`Variables`** tab to add **non-sensitive variables**

Add the following to Secrets:
Name Why it’s a secret
AWS_ACCESS_KEY_ID AWS credential to identify the IAM user
AWS_SECRET_ACCESS_KEY AWS credential to authenticate API calls
ECR_REPOSITORY Repository name used for pushing Docker images

Add the following to Variables:
Name Description
AWS_REGION AWS region you’re deploying to (e.g., us-east-1)
ECS_CLUSTER_PRODUCTION Name of the ECS cluster for production
ECS_SERVICE_PRODUCTION Name of the ECS service for production
ECS_TASK_DEFINITION_PRODUCTION Task definition name for production
ECS_CLUSTER_STAGING ECS cluster name for staging
ECS_SERVICE_STAGING ECS service name for staging
ECS_TASK_DEFINITION_STAGING Task definition name for staging

### Why Some Are Secrets and Others Are Variables?

- **Secrets** contain **sensitive information** like sensitive credentials. They're **encrypted** and **never exposed** in logs or UI.
- **Variables** are **non-sensitive** values used for environment configuration. They’re easier to manage and view/edit.

### Accessing Them in `.yml`

${{ secrets.AWS_ACCESS_KEY_ID }}

${{ vars.ECS_CLUSTER_DEVELOPMENT }}

# GitHub Actions Workflow

Inside the root directory of your project, create `.github/workflows/deploy.yml` file and paste the code below:

```bash
name: Deploy to ECS
on:
  push:
    branches:
      - develop
    tags:
      - 'v*.*.*'
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:22-alpine
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm test
  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build, Tag, and Push to ECR
        run: |
          if [[ "${{ github.ref }}" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            IMAGE_TAG="${GITHUB_REF#refs/tags/}"
          else
            IMAGE_TAG="${{ github.sha }}"
          fi

          docker build -t ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG .
          docker push ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG
  deploy-staging:
    needs: build-and-push
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Install jq
        run: sudo apt-get update && sudo apt-get install -y jq
      - name: Deploy to ECS
        run: |
          TASK_DEF=$(aws ecs describe-task-definition --task-definition ${{ vars.ECS_TASK_DEFINITION_STAGING }} --region ${{ vars.AWS_REGION }})
          NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "${{ secrets.ECR_REPOSITORY }}:${{ github.sha }}" '.taskDefinition | .containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')
          NEW_TASK_RESP=$(aws ecs register-task-definition --region ${{ vars.AWS_REGION }} --cli-input-json "$NEW_TASK_DEF")
          NEW_REVISION=$(echo "$NEW_TASK_RESP" | jq -r '.taskDefinition.family + ":" + (.taskDefinition.revision | tostring)')
          aws ecs update-service --cluster ${{ vars.ECS_CLUSTER_STAGING }} --service ${{ vars.ECS_SERVICE_STAGING }} --task-definition "$NEW_REVISION" --region ${{ vars.AWS_REGION }}
          aws ecs wait services-stable --cluster ${{ vars.ECS_CLUSTER_STAGING }} --services ${{ vars.ECS_SERVICE_STAGING }} --region ${{ vars.AWS_REGION }}
  deploy-production:
    needs: build-and-push
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Install jq
        run: sudo apt-get update && sudo apt-get install -y jq
      - name: Deploy to ECS
        run: |
          TASK_DEF=$(aws ecs describe-task-definition --task-definition ${{ vars.ECS_TASK_DEFINITION_PRODUCTION }} --region ${{ vars.AWS_REGION }})
          NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "${{ secrets.ECR_REPOSITORY }}:${{ github.ref_name }}" '.taskDefinition | .containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')
          NEW_TASK_RESP=$(aws ecs register-task-definition --region ${{ vars.AWS_REGION }} --cli-input-json "$NEW_TASK_DEF")
          NEW_REVISION=$(echo "$NEW_TASK_RESP" | jq -r '.taskDefinition.family + ":" + (.taskDefinition.revision | tostring)')
          aws ecs update-service --cluster ${{ vars.ECS_CLUSTER_PRODUCTION }} --service ${{ vars.ECS_SERVICE_PRODUCTION }} --task-definition "$NEW_REVISION" --region ${{ vars.AWS_REGION }}
          aws ecs wait services-stable --cluster ${{ vars.ECS_CLUSTER_PRODUCTION }} --services ${{ vars.ECS_SERVICE_PRODUCTION }} --region ${{ vars.AWS_REGION }}
```

# Pipeline Structure Explained

name: Deploy to ECS
on:
push:
branches: - develop
tags: - 'v*.*.\*'

The workflow defines four jobs that run in a specific order, with dependencies enforced using needs. Each job runs on an Ubuntu runner (ubuntu-latest) and interacts with AWS services for building and deploying Docker images.

- **name**: The whole workflow is named `Deploy to ECS`.
- **on**: Specifies the events that trigger the workflow:
  - Push to the `develop` branch.
  - Push of a tag matching the pattern `v*.*.*` (e.g., v1.0.0)

### Job: `test`

test:
runs-on: ubuntu-latest
container:
image: node:22-alpine
steps: - name: Checkout code
uses: actions/checkout@v4 - name: Install dependencies
run: npm install - name: Run tests
run: npm test

This job runs for every push to the `develop` branch or when a version tag (e.g., v1.0.0) is created. It ensures the code is tested before proceeding to build or deployment.

- **runs-on**: Uses an `ubuntu-latest` runner.
- **container**: Executes the job inside a `node:22-alpine` Docker container, providing a lightweight Node.js v22 environment.
- **steps**:
  1. **Checkout code**:
     - `uses: actions/checkout@v4`: Clones the repository to the runner, making the code available.
  2. **Install dependencies**:
     - `run: npm install`: Installs dependencies listed in `package.json`.
  3. **Run tests**:
     - `run: npm test`: Executes the test suite defined in `package.json`.

```bash
build-and-push:
  needs: test
  runs-on: ubuntu-latest
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Configure AWS Credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ vars.AWS_REGION }}
    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v2
    - name: Build, Tag, and Push to ECR
      run: |
        if [[ "${{ github.ref }}" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
          IMAGE_TAG="${GITHUB_REF#refs/tags/}"
        else
          IMAGE_TAG="${{ github.sha }}"
        fi

        docker build -t ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG .
        docker push ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG
```

This job builds and pushes a Docker image to `ECR`. For `develop` branch commits, it tags the image with the commit SHA (for staging). For tagged commits, it uses the version tag (for production).

- **`needs: test`**: Ensures the test job completes successfully before this job runs.
- **`runs-on`**: Uses an `ubuntu-latest` runner.
- **steps**:
  1. **Checkout code**:
     - `uses: actions/checkout@v4`: Clones the repository.
  2. **Configure AWS Credentials**:
     - `uses: aws-actions/configure-aws-credentials@v4`: Configures AWS CLI with credentials stored in GitHub Secrets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`.
  3. **Login to Amazon ECR**:
     - `uses: aws-actions/amazon-ecr-login@v2`: Authenticates Docker with AWS ECR, setting up credentials for pushing images.
  4. **Build, Tag, and Push to ECR**:
     - Determines the image tag:
       - If the trigger is a tag (e.g., v1.0.0), sets IMAGE_TAG to the tag name from `${{ github.ref }}`.
       - Otherwise, sets IMAGE_TAG to the commit SHA `${{ github.sha }}`.
     - `docker build -t ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG .`: Builds a Docker image using the Dockerfile in the repository root, tagging it with the ECR repository URL and IMAGE_TAG.
     - `docker push ${{ secrets.ECR_REPOSITORY }}:$IMAGE_TAG`: Pushes the image to the ECR repository specified in `secrets.ECR_REPOSITORY`.

Job: deploy-staging

```bash
deploy-staging:
  needs: build-and-push
  if: github.ref == 'refs/heads/develop'
  runs-on: ubuntu-latest
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Configure AWS Credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ vars.AWS_REGION }}
    - name: Install jq
      run: sudo apt-get update && sudo apt-get install -y jq
    - name: Deploy to ECS
      run: |
        TASK_DEF=$(aws ecs describe-task-definition --task-definition ${{ vars.ECS_TASK_DEFINITION_STAGING }} --region ${{ vars.AWS_REGION }})
        NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "${{ secrets.ECR_REPOSITORY }}:${{ github.sha }}" '.taskDefinition | .containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')
        NEW_TASK_RESP=$(aws ecs register-task-definition --region ${{ vars.AWS_REGION }} --cli-input-json "$NEW_TASK_DEF")
        NEW_REVISION=$(echo "$NEW_TASK_RESP" | jq -r '.taskDefinition.family + ":" + (.taskDefinition.revision | tostring)')
        aws ecs update-service --cluster ${{ vars.ECS_CLUSTER_STAGING }} --service ${{ vars.ECS_SERVICE_STAGING }} --task-definition "$NEW_REVISION" --region ${{ vars.AWS_REGION }}
        aws ecs wait services-stable --cluster ${{ vars.ECS_CLUSTER_STAGING }} --services ${{ vars.ECS_SERVICE_STAGING }} --region ${{ vars.AWS_REGION }}
```

Job: deploy-production

```bash
deploy-production:
  needs: build-and-push
  if: startsWith(github.ref, 'refs/tags/')
  runs-on: ubuntu-latest
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
    - name: Configure AWS Credentials
      uses: aws-actions/configure-aws-credentials@v4
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ vars.AWS_REGION }}
    - name: Install jq
      run: sudo apt-get update && sudo apt-get install -y jq
    - name: Deploy to ECS
      run: |
        TASK_DEF=$(aws ecs describe-task-definition --task-definition ${{ vars.ECS_TASK_DEFINITION_PRODUCTION }} --region ${{ vars.AWS_REGION }})
        NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "${{ secrets.ECR_REPOSITORY }}:${{ github.ref_name }}" '.taskDefinition | .containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)')
        NEW_TASK_RESP=$(aws ecs register-task-definition --region ${{ vars.AWS_REGION }} --cli-input-json "$NEW_TASK_DEF")
        NEW_REVISION=$(echo "$NEW_TASK_RESP" | jq -r '.taskDefinition.family + ":" + (.taskDefinition.revision | tostring)')
        aws ecs update-service --cluster ${{ vars.ECS_CLUSTER_PRODUCTION }} --service ${{ vars.ECS_SERVICE_PRODUCTION }} --task-definition "$NEW_REVISION" --region ${{ vars.AWS_REGION }}
        aws ecs wait services-stable --cluster ${{ vars.ECS_CLUSTER_PRODUCTION }} --services ${{ vars.ECS_SERVICE_PRODUCTION }} --region ${{ vars.AWS_REGION }}
```

This job deploys the Docker image (tagged with the version tag) to the production ECS environment.

- **`needs: build-and-push`**: Runs only after `build-and-push` completes successfully.
- **`if: startsWith(github.ref, 'refs/tags/')`**: Restricts the job to run only for tagged commits (e.g., v1.0.0).
- **`runs-on`**: Uses an `ubuntu-latest` runner.
- **`steps`**: Nearly identical to deploy-staging, with the following differences:
  - Uses `${{ github.ref_name }}` (e.g., v1.0.0) as the image tag instead of the commit SHA.
  - References production-specific variables: `ECS_TASK_DEFINITION_PRODUCTION`, `ECS_CLUSTER_PRODUCTION`, `ECS_SERVICE_PRODUCTION` instead of staging.

## **Workflow Execution Flow**

The workflow executes based on the trigger:

1. **On push to develop branch**:
   - **`test`**: Runs tests.
   - **`build-and-push`**: Builds a Docker image tagged with the commit SHA and pushes it to ECR.
   - **`deploy-staging`**: Deploys the image to the staging ECS environment.
   - **`deploy-production`**: Skipped (no tag).
2. **On push of a tag (e.g., v1.0.0)**:
   - **`test`**: Runs tests.
   - **`build-and-push`**: Builds a Docker image tagged with the version tag and pushes it to ECR.
   - **`deploy-staging`**: Skipped (not develop branch).
   - **`deploy-production`**: Deploys the image to the production ECS environment.

# Deployment Strategy

### `Staging`

- Triggered on **merge to `develop`** branch.
- Automatically deploys to **staging environment.**
- Instant feedback and testing of the latest changes. Mistakes here are non-critical that’s why we allow to trigger the deployment simply on branch merge.

### `Production`

- Triggered on **Git tag push** (e.g., `v1.0.0`).
- Deploys to **production environment.**
- Manual tagging ensures that only **versioned and verified releases** go live, reducing the risk of accidental deployments.
- Mistakes in production are critical, so this strategy gives us more control.
- Tagged versions also make it easier to **track and roll back** releases if needed.

# Pushing Versioned Tags

To create and push a tag that triggers a production deployment, run the following commands on your project’s main branch:
git tag v1.0.0
git push origin v1.0.0
This will trigger the GitHub Action tied to tag pushes, deploying your application to production.
