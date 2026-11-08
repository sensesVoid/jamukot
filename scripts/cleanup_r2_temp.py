import os, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
env = {}
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line and "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
import boto3
from botocore.config import Config
s3 = boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=env['Access_Key_ID'], aws_secret_access_key=env['Secret_Access_Key'],
    config=Config(signature_version="s3v4"), region_name="auto")
BUCKET = env["R2_BUCKET"]
paginator = s3.get_paginator("list_objects_v2")
to_del = []
for page in paginator.paginate(Bucket=BUCKET):
    for obj in page.get("Contents", []):
        if obj["Key"].startswith(".dl_"):
            to_del.append(obj["Key"])
print("temp files in R2:", len(to_del))
for k in to_del:
    s3.delete_object(Bucket=BUCKET, Key=k)
    print("deleted", k)
