<!-- docs/ses-inbound-fix-notes.md -->

# SES Inbound Fix Notes

## Applied Fix

Inbound email started working only after a manual S3 bucket policy was applied to `auxx-dev-inbound-email` to allow SES to write raw MIME objects into `ses/raw/*`.

Applied policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSesPutObject",
      "Effect": "Allow",
      "Principal": {
        "Service": "ses.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::auxx-dev-inbound-email/ses/raw/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceAccount": "XXX"
        }
      }
    }
  ]
}
```

Applied with:

```bash
env AWS_PROFILE=auxxai-dev aws s3api put-bucket-policy \
  --bucket auxx-dev-inbound-email \
  --policy '<policy-json>'
```

## Verified Result

After applying the bucket policy:

- SES stored inbound raw emails in S3
- the SES bridge Lambda was invoked
- Railway `worker` processed the inbound messages successfully

## Temporary Filter Note

A temporary SES receipt filter was used during testing and has since been removed.
