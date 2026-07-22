"""Object storage for user uploads (avatars now, shared-album photos next).

Two interchangeable backends, chosen by env at startup:

- S3Storage when S3_BUCKET is set. Works with AWS S3 and any S3-compatible
  service (Cloudflare R2, MinIO) via the optional S3_ENDPOINT_URL. Objects
  must be publicly readable — either a bucket policy allowing public GET, or
  set S3_PUBLIC_URL to a public/CDN base that fronts the bucket. Stored URLs
  are absolute.
- LocalStorage otherwise: files under backend/uploads, served by the /static
  StaticFiles mount in main.py, stored as host-relative paths. Dev-only —
  production container filesystems are ephemeral (see shipping.md).

Keys are namespaced by feature: "avatars/<file>", "albums/<group_id>/<file>".
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def save(self, key: str, data: bytes, content_type: str) -> str:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"/static/{key}"

    def delete_prefix(self, prefix: str) -> None:
        directory = (self.root / prefix).parent
        if directory.exists():
            for stale in directory.glob(f"{Path(prefix).name}*"):
                stale.unlink(missing_ok=True)


class S3Storage:
    def __init__(
        self,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        public_url: str | None,
    ):
        import boto3  # imported lazily so local dev doesn't require it configured

        self.client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)
        self.bucket = bucket
        self.region = region
        self.endpoint_url = endpoint_url.rstrip("/") if endpoint_url else None
        self.public_url = public_url.rstrip("/") if public_url else None

    def save(self, key: str, data: bytes, content_type: str) -> str:
        # Keys are content-addressed-ish (random suffix per upload), so tell
        # clients to cache them forever; a changed image is a changed URL.
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )
        return self._url(key)

    def _url(self, key: str) -> str:
        if self.public_url:
            return f"{self.public_url}/{key}"
        if self.endpoint_url:
            # Path-style, for R2/MinIO-like endpoints without a public alias.
            return f"{self.endpoint_url}/{self.bucket}/{key}"
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"

    def delete_prefix(self, prefix: str) -> None:
        response = self.client.list_objects_v2(Bucket=self.bucket, Prefix=prefix)
        keys = [{"Key": obj["Key"]} for obj in response.get("Contents", [])]
        if keys:
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})


def _build_storage() -> LocalStorage | S3Storage:
    bucket = os.getenv("S3_BUCKET")
    if bucket:
        return S3Storage(
            bucket=bucket,
            region=os.getenv("AWS_REGION", "us-east-1"),
            endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
            public_url=os.getenv("S3_PUBLIC_URL") or None,
        )
    return LocalStorage(UPLOAD_DIR)


storage = _build_storage()
