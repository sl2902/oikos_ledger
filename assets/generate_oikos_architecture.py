# Save this file as generate_oikos_architecture_final.py
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Aurora
from diagrams.aws.storage import S3
from diagrams.custom import Custom
from diagrams.onprem.client import User

# Assets
openai_logo = "https://raw.githubusercontent.com/skydoves/sandwichable/main/assets/openai.png"
vercel_logo = "https://assets.vercel.com/image/upload/v1607553085/repositories/next-js/next-logo.png"
google_logo = "https://maps.gstatic.com/mapfiles/places/apps/png/71.png"

# CRITICAL: We pass compound=true to the top-level diagram to enable container-edge termination
with Diagram(
    name="Oikos Ledger - Production Architecture", 
    show=False, 
    direction="LR", 
    filename="oikos_ledger_architecture_fixed",
    graph_attr={"compound": "true"}  
):
    
    # 1. Client Layer
    user_browser = User("Browser / Client Canvas")

    # 2. Identity Provider Container
    with Cluster("🔐 Identity Provider") as auth_container:
        google_oauth = Custom("Google OAuth 2.0", google_logo)

    # 3. Vercel Hosting Platform Container
    with Cluster("⚡ Vercel — Next.js 15 Serverless Platform") as vercel_container:
        next_ui = Custom("Next.js UI Engine\n(Login, Txns, Insights, Recs)", vercel_logo)
        
        with Cluster("Backend API Routes") as api_container:
            auth_api = Custom("/api/auth", vercel_logo)
            txn_api = Custom("/api/transactions", vercel_logo)
            insights_api = Custom("/api/insights/query\n(+ Cache Layer)", vercel_logo)
            session_api = Custom("/api/insights/session", vercel_logo)
            recs_api = Custom("/api/recommendations", vercel_logo)

    # 4. AI Core Platform Container
    with Cluster("🧠 OpenAI Core API Platform") as openai_container:
        gpt_mini = Custom("GPT-4o-mini\n(NL->SQL & Insights)", openai_logo)
        embed_model = Custom("text-embedding-3-small\n(Vectors)", openai_logo)
        realtime_api = Custom("Realtime API\n(Bidirectional Voice Node)", openai_logo)

    # 5. AWS Cloud Infrastructure Container
    with Cluster("☁️ AWS Infrastructure (ap-south-1)") as aws_container:
        s3_bucket = S3("Amazon S3\n(Statement Document Store)")
        lambda_parser = Lambda("AWS Lambda (Python 3.12)\n(Parse -> Normalize -> Embed)")
        
        with Cluster("Aurora PostgreSQL Serverless v2 Cluster") as aurora_container:
            aurora_db = Aurora(
                "Core Relational Database\n"
                "• txns • bank_accounts • users\n"
                "• merchants • uploads\n"
                "• query_cache (pgvector 1536d)"
            )

    # --- Structural Layout & Boundaries Configuration ---

    # Browser Connections (Targeting the boundary nodes, but forcing lhead to terminate at container walls)
    user_browser >> Edge(label="HTTPS", lhead=vercel_container.name) >> next_ui
    
    user_browser >> Edge(
        label="Direct Upload via Presigned URL", 
        color="darkgreen", 
        constraint="false", 
        lhead=aws_container.name
    ) >> s3_bucket
    
    user_browser >> Edge(
        label="Direct WebSocket Audio Stream", 
        color="blue", 
        style="dashed", 
        forward=True, 
        reverse=True, 
        constraint="false", 
        lhead=openai_container.name
    ) >> realtime_api

    # Internal Next.js App Step (Keeps alignment perfectly clean)
    next_ui >> Edge(label="Fetch / Request", lhead=api_container.name) >> txn_api

    # API Cluster Outbound connections terminating exactly at target containers
    txn_api >> Edge(
        label="Token Validation Exchange", 
        forward=True, 
        reverse=True, 
        ltail=api_container.name, 
        lhead=auth_container.name
    ) >> google_oauth
    
    txn_api >> Edge(
        label="Execute SQL / Queries", 
        color="purple", 
        ltail=api_container.name, 
        lhead=aws_container.name
    ) >> s3_bucket
    
    txn_api >> Edge(
        label="Model Context Tuning", 
        ltail=api_container.name, 
        lhead=openai_container.name
    ) >> gpt_mini

    # Async Ingestion Pipeline (Stays contained inside AWS cluster)
    s3_bucket >> Edge(label="S3 Event Trigger", color="darkred") >> lambda_parser
    lambda_parser >> Edge(label="Normalize / Embed Flows", color="purple", lhead=aurora_container.name) >> aurora_db