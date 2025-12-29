Setting Up Docker
Lessons
Dockerfile
A Dockerfile is like a recipe for the app’s environment. It’s a script that tells Docker how to build a custom image. By automating this setup, it ensures that the app runs consistently everywhere.
Dockerfile Breakdown

# Base image

FROM node:22-alpine
​
Purpose: Sets the starting point of the image using a lightweight Node.js 22 Alpine base.
Node vs Node:Alpine
node: The full Node.js image, built on Debian. It’s packed with tools but bulky
node:22-alpine: A smaller version based on Alpine Linux. It’s faster to download, uses less disk space, and has a smaller attack surface for better security.
Why use Alpine?
Smaller images means faster builds and deployments. Also, fewer pre-installed packages mean fewer security risks.
Rare compatibility issues with native packages can come up, but they’re usually very rare.

# Set working directory

WORKDIR /app
​
What it does?: Creates and sets /app as the working directory for all future commands in the container.
Why?: Keeps your files organized and avoids cluttering the container’s root directory.

# Set environment to production

ENV NODE_ENV=production
​
What it does?: Sets the NODE_ENV variable to production, enabling optimizations like skipping dev dependencies.
Why?: Ensures the build avoids unnecessary dev tools or verbose logging.

# Install dependencies

COPY package\*.json ./
RUN npm install
​
What it does?: Copies package.json and package-lock.json, then runs npm install to fetch dependencies.
Why?: Isolating this step lets Docker cache the dependency layer. If only your code changes, Docker skips reinstalling dependencies, speeding up builds.

# Copy app files

COPY . .
​
What it does?: Copies all your project files (code, configs, etc.) into the /app directory.
Why?: Gets your app’s source code into the container so it can run.

# Expose the app port

EXPOSE 3001
​
What it does?: Signals that the container listens on port 3001.
Why?: It’s like a heads-up to Docker and other tools about the port your app uses.

# Command to run the app

CMD ["node", "src/index.js"]
​
What it does?: Specifies the command to launch your app when the container starts.
Final Dockerfile code:
.dockerignore
The .dockerignore file tells Docker which files and directories to exclude when building the image. Similar to .gitignore, it prevents unnecessary or sensitive files (like node_modules, .env, or .git) from being copied into the image. This keeps the image smaller, builds faster, and enhances security.
node_modules
.env
Dockerfile
.dockerignore
.git
.gitignore
​
Why Are We Excluding These Files?
node_modules: Rebuilt inside the container during npm install, so no need to include it.
.env: Contains sensitive environment variables.
Dockerfile & .dockerignore: We don’t need build instructions in the final image.
.git & .gitignore: Git history and configs are irrelevant to the running app.
Setup Docker On Your Machine
Create a Docker Hub Account
Go to Docker Hub account and create a new account, this allows us to:
Push and pull images to/from Docker Hub.
Authenticate with the Docker CLI.
Share or collaborate on images with teams.
Download Docker Desktop
Once signed in, you should see a download button. Download and install Docker Desktop on your machine.
To confirm that everythign installed correctly and working, open a terminal and run:
docker --version
​
If you see something like Docker version 28.0.4, you’re good to go! If not, double-check the installation.
Login to Docker Hub
Now we can authenticate our local Docker CLI with Docker Hub account. In the terminal, run:
docker login -u <username>
​
After running the command, you'll be prompted for the password you used during account creation - provide it.
You can find your username by going to Docker Hub, signing in and clicking on your account bubble in the top right corner.

Building the Docker Image
Now it’s time to build our first docker image. In your project’s root directory (where we have the Dockerfile), run:
docker build -t <your_image_name> .
​
docker build: Instructs Docker to create an image based on the Dockerfile we created earlier.
-t <your_image_name>: Tags the image with a name, in our case it will be reminders-api. You could also add a version, like reminders-api:v1.0.0.
.: Points to the current directory as the build context, including the Dockerfile and app files.
We can open Docker Desktop application, navigate to Images and we will see a new image created with the name we provided.
Run the Docker Image
Now that we have the image built, we can run and test it. To do that, in the same terminal run:
docker run -p 3001:3001 --env-file .env reminders-api
​
-p 3001:3001: Maps port 3001 on your host to port 3001 in the container, letting you access the app at http://localhost:3001.
-env-file .env: Loads environment variables from .env file into the container.
reminders-api: The name of the image we are trying to run.
If all goes well, your app should be live at http://localhost:3001. Open a browser and check it out!

aws configure sso
SSO session name (Recommended): my-sso
SSO start URL [None]: https://my-sso-portal.awsapps.com/start
SSO region [None]: us-east-1
SSO registration scopes [sso:account:access]:
Default region name [None]: us-east-1
Default output format [None]: json
CLI profile name [None]: dev

Lets you reference this SSO configuration easily like running aws sso login --profile dev when credentials expire.
cat ~/.aws/config
aws sso login --profile dev

# Creating ECR Repository

- Open the **Elastic Container Registry (ECR)** in AWS Dashboard.
- Click **Create repository**.
- Set the **Repository name** to what you want.
- Keep all default settings:
  - **Mutable**
  - **Default encryption (AES-256)**
- Click **Create**.

# Build and Push Docker Image

Now it’s time to build and push our docker image to the ECR that we just created.

## Authenticate with ECR

Open the terminal in your project and run command below:

```bash
aws ecr get-login-password --region us-east-1 --profile dev \
| docker login --username AWS --password-stdin 704219588443.dkr.ecr.us-east-1.amazonaws.com
```

## Build the Docker Image

This time our command to build the image will be a bit different. In the terminal run:

```bash
docker build --provenance false --platform linux/amd64 -t reminders-api:v1.0.0 .
```

-provenance false: Disables extra metadata which reduces the image size and avoids compatibility issues with certain registries.
-platform linux/amd64: Specifies the target platform for the image (Linux with AMD64 architecture).
t reminders-api:v1.0.0: Tags the image with a name and version.

## Tag the Image for ECR

Now we will need to tag our image with the full ECR repository path before pushing.

```bash
docker tag reminders-api:v1.0.0 704219588443.dkr.ecr.us-east-1.amazonaws.com/reminders-api:v1.0.0
```

## Push the Image to ECR

Finally, we can push the image to the ECR repository by running the command below:

```bash
docker push 704219588443.dkr.ecr.us-east-1.amazonaws.com/reminders-api:v1.0.0
```

# What is a Cluster?

In ECS (Elastic Container Service), a **cluster** is like the foundation for your containerized applications.

It’s like a container that organizes and manages all the different pieces needed to run the app.

- You can imagine a cluster like a neighborhood where all your app components live and work together.
- It doesn’t run anything by itself, but it provides the space and rules for running the containers.

Depending on the setup, the cluster can use:

- **Fargate** (a serverless option where AWS handles the infrastructure)
- **EC2** (where you manage the underlying servers yourself).

# Creating Our Cluster

Let’s set up a cluster to run our API using AWS Fargate.

1. In **`AWS Management Console`** go to **`Elastic Container Service (ECS)`**
2. Click on **`Clusters`** from the left menu.
3. Click **`Create cluster`** button.

## Configure the Cluster

**Cluster Name:** Give any name you want. Good example is **`RemindersApiCluster`.**

**Infrastructure:** Choose **`AWS Fargate (serverless)`.**

**Monitoring:**

- **Container Insights with Enhanced Observability**: Best for complex apps with high traffic.
- **Container Insights**: Gives you enough data for most use cases.
- **Off**: No monitoring and no cost.

# AWS ECS Fargate vs EC2 (Maybe EKS)

- **`ECS with Fargate`** is a serverless option where AWS manages the underlying infrastructure. It’s great for simplicity, automatic scaling, and minimal maintenance. While it's slightly more expensive per resource than EC2, it eliminates the need for server management, patching, and scaling - AWS handles all of that automatically, letting teams focus entirely on app development.
- **`ECS with EC2`** provides more control and *can be* more cost-effective \*\*\*\*if fine-tuned and optimized very well. However, it requires manual server provisioning, capacity planning, patching, and scaling - which can introduce huge operational overhead.
- **`EKS (Elastic Kubernetes Service)`** It’s powerful and flexible, but comes with added complexity and a base control plane cost (around $74/month per cluster, as of now), plus resource costs. It often requires dedicated Kubernetes expertise and is best suited for bigger teams already invested in the Kubernetes ecosystem with teams dedicated just for managing that.

# ECS Task Definition

Now let’s go over the most important settings when creating a Task Definition.

### 1. Task Definition Configuration

- **Task Definition Family**:
  - **Why it matters**: Acts as the identifier for versioning your task definition.
  - **Recommendation**: Use a clear, descriptive name.
  - **Example**: `reminders-api-task-definition`

---

### 2. Infrastructure Requirements

- **Launch Type**:
  - **Why it matters**: Determines the environment.
  - **Recommendation**: Select **`AWS Fargate`** for a managed, scalable API deployment.
- **Operating System/Architecture**:
  - **Why it matters**: Ensures compatibility with your container image.
  - **Recommendation**: Choose **`Linux/X86_64`** unless your API requires ARM64 or Windows (most APIs use Linux/X86_64).
- **Network Mode**:
  - **Why it matters**: Defines networking setup. Fargate requires `awsvpc` for VPC integration.
  - **Recommendation**: Use **`awsvpc`** (default for Fargate). No alternative options exist.

---

### 3. Task Size (Total Resources For All Containers)

- **CPU and Memory**:
  - **Why it matters**: Sets the total resources available to the task, impacting performance and cost.
  - **Recommendation**: Start with **`1 vCPU`** and **`3 GB memory`** for a typical API. Can be easily changed later.
  - **Example**: `1 vCPU`, `3 GB` for a moderately busy API.

### 4. Task Roles

- **Task Role**:
  - **Why it matters**: Grants containers permissions to call AWS APIs (e.g., S3, DynamoDB).
  - **Recommendation**: Create a custom IAM role with least-privilege permissions for your API’s needs. Avoid overly broad roles.
  - **Example**: Role with s3:GetObject and dynamodb:PutItem for specific operations.
- **Task Execution Role**:
  - **Why it matters**: Allows ECS to pull images from ECR and send logs to CloudWatch.
  - **Recommendation**: Use the default `ecsTaskExecutionRole`.
  - **Example**: `ecsTaskExecutionRole`

---

### 5. Container Details

- **Name**:
  - **Why it matters**: Identifies the container within the task.
  - **Recommendation**: Use a descriptive name like `reminders-api-container`.
- **Image URI**:
  - **Why it matters**: Specifies the Docker image for your API.
  - **Recommendation**: Paste an ECR `Image URI`.
- **Essential Container**:
  - **Why it matters**: Marks the container as critical. If it fails, the task stops.
  - **Recommendation**: Set to **`Yes`** for your API container (required for single-container tasks).

### 6. Port Mappings

- **Container Port and Protocol**:
  - **Why it matters**: Defines how external traffic reaches your API.
  - **Recommendation**: Set the port your API listens on like `3001` and protocol `TCP`. Use `HTTP` for App Protocol if integrating with an ALB because the container itself usually just speaks plain HTTP internally.
- **Port Name**:
  - **Why it matters**: Used for service discovery or ALB integration.
  - **Recommendation**: Assign a meaningful name or leave blank for a default.

---

### 7. Resource Allocation Limits (For Container)

- **CPU and Memory Limits**:
  - **Why it matters**: Defining limits ensures that a container doesn't consume more CPU or memory than expected.
  - **Recommendation**:
    - Set a **`Memory Hard Limit`** (`3 GB`) to cap the maximum memory a container can use. If it exceeds this, ECS will terminate it.
    - Use a **`Memory Soft Limit`** (`2 GB`) to reserve a guaranteed baseline amount of memory for your container. This ensures the app gets consistent performance under normal load, but allows flexibility to scale up temporarily if resources are available.
    - If only one container, give all the available `vCPU` that we defined in the `Task Size` limits.
  - **Example**: `1 vCPU`, `3 GB hard limit`, `2 GB soft limit`

### 8. Environment Variables

- **Why it matters**: Configures runtime environment variables (database URLs, API keys, port numbers).
- **Recommendation**: Add key-value pairs for non-sensitive data like `PORT=3001`. For sensitive data, use `AWS Secrets Manager`.
- **Example**: `PORT=3001` (Value), `DATABASE_URL=arn:aws:secretsmanager:us-east-1:ID_GOES_HERE:secret:prod/reminders-api/database-url-ID:DATABASE_URL::`` (ValueFrom)

### Create a new secret

1. **`Go to AWS Secrets Manager`** → **`Store a new secret`**
2. **Secret Type: `Other type of secret`**
3. **Key/value pairs:** Key - **`DATABASE_URL`** / Value - **`postgresql://neondb_owner....`**
4. **Encryption Key: `aws/secretsmanager`**
5. Click **`Next`**
6. Now go to your newly created secret and under **`Secrets details`** you will see **`Secret ARN`**

### 9. Logging

- **Log Collection**:
  - **Why it matters**: Centralizes logs for debugging and monitoring.
  - **Recommendation**: Enable log collection and leave the rest on default.

---

### 10. Storage

- **Ephemeral Storage**:
  - **Why it matters**: Provides temporary storage for your API (e.g., for caching or logs).
  - **Recommendation**: Default is 21 GiB. Increase to 21–200 GiB if your API requires more (e.g., for large file processing).
  - **Example**: 50 GiB for heavy workloads. 21 GiB good for most.

---

### 11. Monitoring

- **Why it matters**: Provides traceability and performance metrics to debug issues, monitor API health, and optimize resource usage.
- **Recommendation**: More times than not we will not need this as we will have enough logs for starting out. You can enable it later if needed.

## Skipped Fields

- **Private Registry Authentication**: Only required if you're pulling images from a **non-ECR (Elastic Container Registry)** source, like Docker Hub or a private registry. If you're using **ECR**, ECS handles auth automatically.
- **Read Only Root File System**: Can enhance container security, but **not required** unless your API can run without writing to disk. Many APIs write temp files, logs, or caches, so this is often disabled by default.
- **Restart Policy, Container Timeouts, Docker Configuration, Ulimits, Docker Labels**: Very rarely needed for standard API workloads. Configure only if specific requirements exist.
- **Task Placement Constraints, Fault Injection, Volumes, Volumes From**: Not applicable or rarely used for Fargate APIs.
- **Startup Dependency Ordering**: Only relevant for multi-container tasks.
- **Tags:** Completely optional, but helpful for organizing resources by project, environment, or team. You won’t break anything by skipping them — though they’re a good practice in mature environments.

## Add `SecretsManagerReadWrite` to `ecsTaskExecutionRole`

1. Go to **`IAM in the AWS Console`** → Select **`Roles`** in the left menu.
2. In the search look for **`ecsTaskExecutionRole`** and select it.
3. Under **`Permissions policies`** press **`Add permissions`** and **select `Attach policies`.**
4. Under **`Other permissions policies`** search for **`SecretsManagerReadWrite`** and select it.
5. Click **`Add permissions`** button**.**
6. Now you should see this new permission under **`Permissions policies`** in **`ecsTaskExecutionRole`** role.

# ECS Cluster Service

Now let’s go over the most important settings when creating a Cluster Service.

### 1. Environment and Compute Configuration

- **Compute Options:**
  - **Why it matters**: Defines the underlying compute infrastructure for ECS tasks.
  - **Recommendation**: Use **`Launch Type: Fargate`** for a fully managed, serverless API deployment. Avoid **Capacity Provider Strategy** unless you need advanced Task placement control (e.g., mixing Fargate with EC2 or custom scaling logic).
  - **Example**: **`Launch Type: Fargate`**
- **Platform Version**:
  - **Why it matters**: Determines the Fargate platform version, affecting features and security.
  - **Recommendation**: Use **`LATEST`** for the most recent updates and patches.

### 2. Deployment Configuration

- **Task Definition Family and Revision**:
  - **Why it matters**: Links the Service to the Task Definition that defines your API’s containers.
  - **Recommendation**: Select the Task Definition we just created and the latest `Task definition revision`.
- **Service Name**:
  - **Why it matters**: Uniquely identifies the Service within the cluster.
  - **Recommendation**: Use a descriptive name like `reminders-api-service`
- **Service Type**:
  - **Why it matters**: Defines how Tasks are deployed and managed.
  - **Recommendation**: Choose **`Replica`** to maintain a desired number of Tasks, supporting load balancing and scaling.
- **Desired Tasks**:
  - **Why it matters**: Sets the number of running Tasks (API instances).
  - **Recommendation**: Start with 2–4 Tasks for high availability.
- **Availability Zone rebalancing:**
  - **Why it matters**: Tries to **distribute your ECS tasks evenly across Availability Zones** (AZs)
  - **Recommendation**: Keep it `ON`.
- **Health Check Grace Period**:
  - **Why it matters**: Prevents premature health check failures during Task startup.
  - **Recommendation**: Set to 30–120 seconds based on your API’s startup time.
  - **Example**: `60 seconds`

### 3. Networking

- **VPC**:
  - **Why it matters**: It's the isolated network where your tasks run - defines routing, internet access, and security.
  - **Recommendation**: Use the **default VPC** if you're starting out, want simplicity, and have a small user base; create a **custom VPC** for greater control, best practice, more security, and scalability.

### How to create custom VPC

1. Press **`Create a new VPC`**
2. Choose **`VPC and more`**
3. Choose **`Auto-generate`** name tag.
4. Name your VPC something like **`my-fargate-vpc`**
5. IP**v4 CIDR**: Keep the default (**`10.0.0.0/16`**)
6. Keep **`No IPv6 CIDR block`**
   - For most **Fargate + ALB** setups **IPv4 is totally sufficient**. You can always add IPv6 support later if needed.
7. **Tenancy**: Leave as **`Default`**
8. Number of Availability Zones: **`2`**
9. Number of public subnets: **`2`**
10. Number of private subnets: **`2`**
11. NAT gateways: **`In 1 AZ`**
    - **None**: No internet access for private subnets; tasks can’t pull ECR images or log to CloudWatch. **Not recommended.**
    - **In 1 AZ**: One NAT Gateway (~$32/month) in one public subnet. Sufficient for most production APIs, cost-effective, but single AZ failure could disrupt internet access. **Recommended Option**.
    - **1 per AZ**: Two NAT Gateways (~$64/month), one per AZ. High availability but costly and complex. Only for critical APIs.
12. VPC endpoints: **`S3 Gateway`**
13. DNS Options: **`both checked`**
14. Click **`Create VPC`**

- **Subnets**:
  - **Why it matters**: Subnets control **where** your tasks are placed and whether they’re exposed to the internet.
  - **Recommendation**: Use **private subnets** in **at least two Availability Zones** for better security and high availability.
- **Security Group**:
  - **Why it matters**: Acts like a firewall, controls what can talk to your tasks.
  - **Recommendation**: Create a security group allowing inbound traffic on the API port `3001` and on port `80` for health checks.
- **Public IP**:
  - **Why it matters**: Assigns a public-facing IP address to your task, which affects security.
  - **Recommendation**: Set to `Off` if you created a custom VPC. Your ALB will have the public IP, and forward traffic to private tasks - safer and cleaner.
      <aside>
      ❗
      
      **THIS WAS NOT MENTIONED IN THE LIVESTREAM BUT IT’S VERY IMPORTANT:**
      
      If you decided to use the **`default VPC`** and you’re also storing some values in **`AWS Secrets Manager`**, make sure to leave the **`“Public IP”`** setting **`ON`**.
      
      </aside>

### 4. Load Balancing

A **Load Balancer** is a service that distributes incoming network traffic across multiple servers or instances to ensure that no single server is overwhelmed, improving application reliability and performance.

It helps ensure high availability and fault tolerance by automatically rerouting traffic to healthy instances if one fails, making it essential for handling large volumes of traffic in scalable applications.

- **Use Load Balancing**:
  - **Why it matters**: Distributes traffic across Tasks for high availability and scalability.
  - **Recommendation**: Enable **`Application Load Balancer (ABL)`.**
- **Load Balancer Type**:
  - **Why it matters**: Determines load balancing capabilities.
  - **Recommendation**: Choose **`Application Load Balancer`** for HTTP-based routing and health checks.
- **Container**:
  - **Why it matters**: Maps the ALB to your API’s container and port.
  - **Recommendation**: Select your container and port (usually default option).
  - **Example**: `reminders-api 3001:3001`
- Application Load Balancer:
  - **Recommendation**: Select **`Create a new load balancer` .**
- Load Balancer Name:
  - **Recommendation**: Provide a meaningful name like `reminders-api-lb`
- **Listener**:
  - **Why it matters**: Defines how the ALB accepts traffic.
  - **Recommendation**: Use `HTTP:80` for testing (later we will add `HTTPS:443` (with SSL) for production).
  - **Example**: `HTTP:80`
- **Target Group**:
  - **Why it matters**: Routes traffic to healthy Tasks.
  - **Recommendation**: Create a new target group with HTTP protocol, a health check path of `/health`, and short deregistration delay.
  - **Example**: Target Group Name: `reminders-api-tg`, Health Check Path: `/health`, Deregistration Delay: `300 seconds`

### 5. Service Auto Scaling

**Auto Scaling** automatically adjusts the number of running instances or tasks based on the current traffic load or resource utilization (like CPU or memory). It helps maintain consistent application performance during traffic spikes while optimizing costs by reducing resources during low traffic periods.

Auto Scaling ensures that application always has the right amount of capacity to handle varying demand efficiently.

- **Use Service Auto Scaling**:
  - **Why it matters**: Adjusts Task count based on demand, optimizing performance and cost.
  - **Recommendation**: `Enable` to handle traffic fluctuations.
- **Minimum Number of Tasks**:
  - **Why it matters**: Ensures a baseline for availability.
  - **Recommendation**: Set to 2 for higher availability and 1 for starting out.
- **Maximum Number of Tasks**:
  - **Why it matters**: Caps scaling to control costs.
  - **Recommendation**: Set based on peak load and budget.
  - **Example**: 2-3 for starting out and add more if needed later.
- **Scaling Policy Type**:
  - **Why it matters**: Defines how scaling decisions are made.
  - **Recommendation**: Use **`Target Tracking`** for simplicity, targeting `CPU`.
  - **Example**:
    - `Target Tracking`
    - Name: `reminders-api-scaling-policy`
    - Metric: `CPUUtilization`
    - Target Value: `60`
    - Scale-out Cooldown: `240 seconds`
    - Scale-in Cooldown: `300 seconds`
      **Explanations:**
  - **Scale Out**:
    - **Increase the number of tasks** when traffic increases, CPU or memory usage rises, or other conditions trigger the scaling policy.
    - This helps your app **handle more traffic** by adding more containers.
    - **Scale-out cooldown**: How long ECS waits before adding more tasks after scaling out.
      - We don’t want ECS to keep adding tasks too quickly as it could **over-scale** in response to short-term spikes.
  - **Scale In**:
    - **Decrease the number of tasks** when usage drops or traffic goes down.
    - This reduces your costs by removing unnecessary containers when the load is low.
    - **Scale-in cooldown**: How long ECS waits before scaling in after tasks are removed.
      - A longer cooldown helps avoid **flapping**, where ECS keeps adding and removing tasks unnecessarily in short periods.

## Skipped Fields

- **Deployment Options: Deployment Failure Detection**:
  Default settings are good. ECS automatically handles deployment failures and recovers without custom settings. Rarely needed for API services.
- **Service Connect**:
  Only needed if your API communicates directly with other ECS services in the same cluster. Unnecessary for APIs behind a Load Balancer.
- **Service Discovery**:
  Enables DNS for internal service communication. Not needed for APIs using a Load Balancer for traffic routing.
- **VPC Lattice**:
  Designed for networking across multiple VPCs or AWS accounts. Not needed for a single API in one VPC with a Load Balancer.
- **Volume**:
  Optional. Only needed if your task definition requires additional storage (e.g., EFS).
- **Tags**:
  Optional but useful for organizing and tracking costs (e.g., by project or environment). Skipping them doesn’t affect functionality.

# Register a Custom Domain with Route 53

1. Open the **`AWS Management Console`** and navigate to `Route 53`.
2. Go to **`Registered domains` → `Register domains`**.
3. Search for a domain you want and click **`Search`** to check availability.
4. Click **`Select`** on the domain you would like to purchase and then click **`Proceed to checkout`.**
5. Complete the form with contact info, enable **Auto-renew** and **Privacy Protection**, and complete the purchase.
6. AWS will send a verification email to the registrant address - approve it to finalize the registration.

<aside>
💡

Using Route 53 streamlines DNS management and integrates seamlessly with other AWS services like ACM and ALB but you can use any other service to buy the domain, the next steps will remain similar still.

</aside>

# Request a SSL/TLS Certificate

1. Go to **`AWS Certificate Manager (ACM)`**.
2. Click **`Request a certificate` →** Select **`Request a public certificate` →** Click **`Next`.**
3. Add your domain name that you just purchased and verified: **`*.mydomain.com`**
4. Choose **`DNS validation`** , **`RSA 2048`** key algorithm and click **`Request`**.
5. In **`Domains`** table you'll see one record with **`CNAME name` and `CNAME value` .**

# Validate the Certificate

1. In **`Route 53` → `Hosted Zones`**, select your hosted zone.
2. Click **Create record**:
   - **Record name**: Paste the **`CNAME name`** from ACM. (Make sure you don’t add the last part (domain name) as it is added automatically)
   - **Record Type**: **`CNAME`**
   - **Value**: Paste the **`CNAME value`** from ACM
3. Click **`Create records`**.

<aside>
💡

Validation usually takes a few minutes but it also may take more. When done, ACM will show status: **Issued.**

</aside>

# Enable HTTPS

1. In **`EC2` → `Load Balancers`**, find the load balancer we created for the ECS**.**
2. In **`Listeners and rules`** tab click **`Add listener`**:
   - **Protocol**: HTTPS
   - **Port**: 443
   - **Default action**: Forward to target groups → Select the target group we created earlier.
   - **Default SSL/TLS server certificate**: Choose from ACM → select your certificate
3. Save the listener.

You should now see both listeners:

- **HTTP: 80**
- **HTTPS: 443**

# Redirect HTTP to HTTPS

1. On the ALB’s **`Listeners** **and** **rules**` tab, select the **`HTTP:80`\*\* listener.
2. Select **`Default`** rule → **`Actions`** → **`Edit rule`**.
3. Under **`Routing actions`:**
   - **Action**: Redirect to URL → URI parts
   - **Protocol**: HTTPS
   - **Port**: 443
4. Click **`Save changes`**.

# Allow HTTPS Traffic in Security Groups

1. Go to **`EC2` → `Security Groups`**, find the one attached to your ALB.
2. Click **`Edit inbound rules`** → **`Add rule`**:
   - **Type**: HTTPS
   - **Protocol**: TCP
   - **Port Range**: 443
   - **Source**: Anywhere-IPv4
3. Click **`Add rule`**:
   - **Type**: HTTPS
   - **Protocol**: TCP
   - **Port Range**: 443
   - **Source**: Anywhere-IPv6
4. Click **`Save rules`**.

# Custom Domain

1. Go to **`Route 53` → `Hosted Zones` →** Choose your zone.
2. Click **`Create record`**:
   - **Record name**: **`reminders-api`** (for **`reminders-api.mydomain.com`**)
   - **Type**: **`A`**
   - **Alias**: Toggle ON
   - **Alias Target**: Select Route traffic to **`Alias to Application and Classic Load Balancer`**
   - **Region**: Select the region where you have your **`Load Balancer`**
   - From the dropdown select your **`Load Balancer`**
3. Click **`Create records`**.
4. Open **`https://reminders-api.mydomain.com`** in your browser. You should see the secure padlock icon and be routed to your Fargate app via HTTPS.

<aside>
💡

DNS changes may take 1–48 hours to fully propagate, but usually it works within a few minutes.

</aside>
