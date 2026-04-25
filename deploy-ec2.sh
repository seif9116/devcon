#!/usr/bin/env bash
set -euo pipefail

APP_NAME="devcon"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
INSTANCE_TYPE="t2.large"
REPO_URL="${1:?Usage: ./deploy-ec2.sh <git-repo-url>}"

echo "==> Deploying ${APP_NAME} to EC2 in ${REGION}"

# 1. Get default VPC
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region "${REGION}")

# 2. Security group allowing SSH + app port
SG_NAME="${APP_NAME}-ec2-sg"
SG_ID=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" --query 'SecurityGroups[0].GroupId' --output text --region "${REGION}" 2>/dev/null)
if [ "${SG_ID}" = "None" ] || [ -z "${SG_ID}" ]; then
  SG_ID=$(aws ec2 create-security-group --group-name "${SG_NAME}" --description "EC2 ${APP_NAME}" --vpc-id "${VPC_ID}" --query 'GroupId' --output text --region "${REGION}")
fi
aws ec2 authorize-security-group-ingress --group-id "${SG_ID}" --protocol tcp --port 22 --cidr 0.0.0.0/0 --region "${REGION}" 2>/dev/null || true
aws ec2 authorize-security-group-ingress --group-id "${SG_ID}" --protocol tcp --port 3000 --cidr 0.0.0.0/0 --region "${REGION}" 2>/dev/null || true

# 3. Latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
  --output text --region "${REGION}")

# 4. User data script — runs on first boot
USER_DATA=$(cat <<'BOOTEOF'
#!/bin/bash
exec > /var/log/app-deploy.log 2>&1
set -ex
dnf install -y git tar gzip xz
curl -fsSL https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-x64.tar.gz -o /tmp/node.tar.gz
tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1
node --version
cd /home/ec2-user
git clone __REPO_URL__ app
cd app
npm ci
npm run build
HOST=0.0.0.0 PORT=3000 npm start
BOOTEOF
)
USER_DATA="${USER_DATA/__REPO_URL__/${REPO_URL}}"

# 5. Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "${AMI_ID}" \
  --instance-type "${INSTANCE_TYPE}" \
  --security-group-ids "${SG_ID}" \
  --key-name devcon \
  --user-data "${USER_DATA}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${APP_NAME}}]" \
  --query 'Instances[0].InstanceId' \
  --output text \
  --region "${REGION}")

echo "==> Instance ${INSTANCE_ID} launching, waiting for public IP..."
aws ec2 wait instance-running --instance-ids "${INSTANCE_ID}" --region "${REGION}"

PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "${INSTANCE_ID}" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text --region "${REGION}")

echo ""
echo "==> Instance: ${INSTANCE_ID}"
echo "==> App will be at http://${PUBLIC_IP}:3000 (give it ~2 min to install and build)"
echo ""
echo "To tear down:"
echo "  aws ec2 terminate-instances --instance-ids ${INSTANCE_ID} --region ${REGION}"
