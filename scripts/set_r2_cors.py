import os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
env = {}
with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")) as f:
    for line in f:
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
import boto3
from botocore.config import Config
endpoint = "https://" + env["R2_ACCOUNT_ID"] + ".r2.cloudflarestorage.com"
s3 = boto3.client("s3", endpoint_url=endpoint,
    aws_access_key_id=env["Access_Key_ID"], aws_secret_access_key=env["Secret_Access_Key"],
    config=Config(signature_version="s3v4"), region_name="auto")
cors = {
  "CORSRules": [{
    "AllowedOrigins": ["https://sensesvoid.github.io", "http://localhost", "http://127.0.0.1"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
    "MaxAgeSeconds": 3600
  }]
}
s3.put_bucket_cors(Bucket=env["R2_BUCKET"], CORSConfiguration=cors)
print("CORS set")
print(s3.get_bucket_cors(Bucket=env["R2_BUCKET"]))
