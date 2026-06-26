flowchart LR
    %% Style Declarations
    classDef user fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#000
    classDef client fill:#efebe9,stroke:#5d4037,stroke-width:2px,color:#000
    classDef gateway fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    classDef compute fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
    classDef database fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef storage fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#000

    %% 1. Client Layer
    subgraph UserTier["👤 Client Boundary"]
        User["Browser / Client Canvas"]:::user
    end

    %% 2. Web Hosting & Compute Layer
    subgraph Vercel["⚡ Vercel — Next.js 15 Serverless Platform"]
        NextClient["Next.js UI Engine\n(Login · Transactions · Insights · Recs)"]:::client
        
        subgraph API["Backend API Routes"]
            AuthAPI["/api/auth"]:::compute
            TxnAPI["/api/transactions"]:::compute
            InsightsAPI["/api/insights/query\n(+ Cache Layer)"]:::compute
            SessionAPI["/api/insights/session"]:::compute
            RecsAPI["/api/recommendations"]:::compute
            UploadAPI["/api/upload"]:::compute
        end
    end

    %% 3. Identity Provider
    subgraph AuthCloud["🔐 Identity Provider"]
        Google["Google OAuth 2.0"]:::gateway
    end

    %% 4. AI Core Model Layer
    subgraph OpenAI["🧠 OpenAI Core API Platform"]
        GPT["GPT-4o-mini\n(NL→SQL · Insights)"]:::gateway
        Embed["text-embedding-3-small\n(Query + Merchant Vectors)"]:::gateway
        Realtime["Realtime API\n(Bidirectional Voice Node)"]:::gateway
    end

    %% 5. Cloud Infrastructure Layer
    subgraph AWS["☁️ AWS Infrastructure (ap-south-1)"]
        S3["📦 [Amazon S3]\nStatement Document Store"]:::storage
        Lambda["⚡ [AWS Lambda]\nParse → Normalize → Embed"]:::compute
        
        subgraph Aurora["🗄️ Aurora PostgreSQL Serverless v2 Cluster"]
            DB["Database Instance\n• transactions  • bank_accounts\n• users  • merchants  • uploads\n• query_cache (pgvector 1536d)"]:::database
        end
    end

    %% --- Connection Pathways ---
    User -->|HTTPS| NextClient
    User <-->|Direct WebSocket Audio Stream| Realtime

    NextClient -->|Session Handshake| AuthAPI
    NextClient -->|Fetch Records| TxnAPI
    NextClient -->|Submit Text Prompt| InsightsAPI
    NextClient -->|Request Ephemeral Token| SessionAPI
    NextClient -->|POST Tailored Feeds| RecsAPI
    NextClient -->|Upload CSV| UploadAPI

    AuthAPI <-->|Token Validation Exchange| Google

    TxnAPI -->|Read / Write Ledger Data| DB
    InsightsAPI -->|Execute Compiled SQL| DB
    RecsAPI -->|Rolling Baseline Query| DB

    InsightsAPI -->|Translate Text to SQL| GPT
    InsightsAPI -->|Generate Query Vector| Embed
    InsightsAPI -->|Vector Semantic Search| DB
    RecsAPI -->|Insight → Impact → Action Analysis| GPT
    SessionAPI -->|Provision Access Token| Realtime

    UploadAPI -->|Store File| S3
    UploadAPI -->|Invoke Lambda| Lambda
    Lambda -->|Read File| S3
    Lambda -->|Normalize Merchants| GPT
    Lambda -->|Generate Merchant Name Vectors| Embed
    Lambda -->|Atomic Row Insertion| DB

    %% Apply structural container backgrounds
    class Vercel,AWS,AuthCloud,OpenAI compute;

    %% --- Dynamic Link Color Stylings ---
    %% All default lines in gold
    linkStyle 0,1,2,3,4,5,6,7,8,16,17 stroke:#f59e0b,stroke-width:2px;

    %% Routes going to Aurora in Green
    linkStyle 9,10,11,14 stroke:#2e7d32,stroke-width:2.5px;
    
    %% Lambda to Aurora in Blue
    linkStyle 22 stroke:#1565c0,stroke-width:2.5px;
    
    %% Routes to OpenAI in Purple
    linkStyle 12,13,15 stroke:#6a1b9a,stroke-width:2.5px;
    
    %% Lambda to OpenAI in Black
    linkStyle 18,19,20,21 stroke:#212121,stroke-width:2.5px;