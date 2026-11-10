#!/usr/bin/env python3
"""Delete a track from audio/ (or R2) and tracks.json."""
import argparse, json, os, sys, subprocess
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from urllib.parse import unquote

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACKS = os.path.join(BASE, "data", "tracks.json")
AUDIO_DIR = os.path.join(BASE, "audio")


def load():
    with open(TRACKS, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    with open(TRACKS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--id", type=int)
    g.add_argument("--title")
    ap.add_argument("--artist")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    data = load()
    tracks = data["tracks"]

    candidates = []
    for t in tracks:
        if args.id is not None and t["id"] == args.id:
            candidates.append(t)
        elif args.title:
            if args.title.lower() in t["title"].lower():
                if args.artist and args.artist.lower() not in t["artist"].lower():
                    continue
                candidates.append(t)
    if len(candidates) == 0:
        print("Track not found.")
        sys.exit(1)
    if len(candidates) > 1:
        print("Multiple matches found. Use --id to pick one:")
        for t in candidates:
            print(f"  id={t['id']}  {t['artist']} - {t['title']}")
        sys.exit(1)
    target = candidates[0]

    print(f"Deleting: {target['artist']} - {target['title']}")

    url = target.get("url", "")
    if url.startswith("http"):
        # legacy R2 track — try to delete from R2
        try:
            import boto3
            from botocore.config import Config
            env = {}
            env_path = os.path.join(BASE, ".env")
            if os.path.exists(env_path):
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and "=" in line and not line.startswith("#"):
                            k, v = line.split("=", 1)
                            env[k.strip()] = v.strip()
            access = env.get("Access_Key_ID") or env.get("R2_ACCESS_KEY_ID")
            secret = env.get("Secret_Access_Key") or env.get("R2_SECRET_ACCESS_KEY")
            bucket = env.get("R2_BUCKET", "jamukot-audio")
            account = env.get("R2_ACCOUNT_ID", "5eaa981f4ddcdefe097a949285c222")
            s3 = boto3.client("s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
                aws_access_key_id=access, aws_secret_access_key=secret,
                config=Config(signature_version="s3v4"), region_name="auto")
            key = unquote(url.rsplit("/", 1)[-1])
            s3.delete_object(Bucket=bucket, Key=key)
            print("Deleted from R2.")
        except Exception as e:
            print(f"R2 delete warning: {e}")
    else:
        # local Opus track — remove the file
        opus_path = os.path.join(BASE, url)
        try:
            os.remove(opus_path)
            print(f"Deleted: {opus_path}")
        except OSError as e:
            print(f"File delete warning: {e}")

    tracks = [t for t in tracks if t["id"] != target["id"]]
    data["tracks"] = tracks
    save(data)
    print(f"Removed from tracks.json. {len(tracks)} tracks remain.")

    if args.push:
        subprocess.run(["git", "add", "-A"], cwd=BASE, check=True)
        subprocess.run(["git", "commit", "-m", f"Delete track: {target['artist']} - {target['title']}"], cwd=BASE, check=True)
        subprocess.run(["git", "push"], cwd=BASE, check=True)
        print("Pushed.")


if __name__ == "__main__":
    main()
PY