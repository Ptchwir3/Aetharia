# AETHARIA

A Kubernetes-native, decentralized metaverse Proof of Concept designed to run on clusters of Raspberry Pis or x86 servers.  
A modular, containerized system built for experimentation in distributed world simulation, procedural terrain generation, and AI-driven agents.

---

## 📦 Repository Structure

Aetharia/
├── AI_Agents/ # AI agent dockerized service
│ ├── Decision_Engine/
│ ├── Memory_Core/
│ ├── Dockerfile
│
├── Backend/ # Main backend game server
│ ├── Src/
│ ├── Player/
│ ├── AI_Agents/
│ ├── Dockerfile
│ ├── package.json
│
├── Frontend/ # Placeholder for future client/UI
│ ├── Public/
│ ├── Src/
│ ├── Dockerfile
│ ├── package.json
│
├── Helm/ # Helm chart for Kubernetes deployment
│ ├── Chart.yaml
│ ├── values.yaml
│ └── Templates/
│ ├── deployment.yaml
│ ├── service.yaml
│ └── ...
│
├── K8S/
│ └── registry-deployment.yaml # Optional local Docker registry
│
├── Shared/
│ ├── Proto/
│ └── Utils/
│
├── LICENSE
└── README.md


---

## 🛠 Prerequisites

You will need:

- Docker
- Node.js >= 18
- kubectl
- Helm v3
- A container registry (Docker Hub, GHCR, etc.)
- A Kubernetes cluster (k3s, kubeadm, kind, microk8s, etc.)

---

# 🧪 Local Development (Backend Only)

Run the backend locally without Kubernetes:

```bash
cd Backend
npm install
npm start


If successful, you’ll see:

🌍 AETHARIA server running on port 8080 Where you can access it at ws://Localhost:8080

🐳 Docker Builds

Aetharia includes three services you can containerize:

Backend

AI_Agents

Frontend (optional)

You may deploy only the backend or the full stack.


1️⃣ Build Backend Container

Dockerfile located in:

Aetharia/Backend/Dockerfile

cd Backend
docker build -t YOUR USER NAME/aetharia-backend:latest .
docker push YOUR USER NAME/aetharia-backend:latest

Replace YOUR USER NAME with your actual registry username


2️⃣ Build AI Agents Container

Dockerfile located in:

Aetharia/AI_Agents/Dockerfile

Build and Push:
cd AI_Agents
docker build -t YOUR USER NAME/aetharia-agents:latest .
docker build push YOUR USER NAME/aetharia-agents:latest .

3️⃣ Build Frontend Container (Optional)

Aetharia/Frontend/Dockerfile

Build and Push:
cd Frontend
docker build -t YOUR USER NAME/aetharia-frontend:latest .
docker push YOUR USER NAME/aetharia-frontend:latest


☸️ Kubernetes Deployment (Helm)

Aetharia ships with a complete Helm chart under:

Aetharia/Helm

1. Update image values

Edit: Helm/values.yaml

Set your Backend Image:
image:
  repository: YOUR USER NAME/aetharia-backend
  tag: "latest"
  pullPolicy: IfNotPresent

If you wish to deploy the agents or frontend, you may create additional templated deployments or extend the chart.

2. Deploy with Helm

From the repo root:

helm upgrade --install aetharia ./Helm \
  --namespace aetharia \
  --create-namespace


3. Verify Deployment
kubectl get pods -n aetharia
kubectl get svc  -n aetharia


4. Port Forward to Test
kubectl port-forward svc/aetharia-backend 8080:80 -n aetharia

Then connect to: ws://localhost:8080


🐙 Raw Kubernetes Deployment (No Helm)
Apply the optional local registry:
kubectl apply -f K8S/registry-deployment.yaml

Additional raw manifests may be added as needed.

⚙️ Full Multi-Service Build (Backend + Agents + Frontend)
For users who want the complete environment:
docker build -t patchwire/aetharia-backend:latest ./Backend
docker build -t patchwire/aetharia-agents:latest   ./AI_Agents
docker build -t patchwire/aetharia-frontend:latest ./Frontend

docker push patchwire/aetharia-backend:latest
docker push patchwire/aetharia-agents:latest
docker push patchwire/aetharia-frontend:latest


🧱 Architecture Overview
Component	Description
Backend	Player  WebSocket server, zone authority, procedural terrain
AI_Agents	Autonomous NPC behavior (decision trees, memory systems)
Frontend	Placeholder for future UI/visualization
Helm	        Automated Kubernetes deployment
Kubernetes	Cluster scheduling, scaling, service networking

🧭 Getting Started (For Experimenters)
git clone https://github.com/Ptchwri3/Aetharia.git
cd Aetharia

cd Backend
npm install
npm start
Then build a Docker image and deploy via Helm to run Aetharia inside Kubernetes.

👤 Maintainer

Josh “Ptchwir3” Nelson
Builder of decentralized systems, autonomous drones, and experimental metaverse architectures.



