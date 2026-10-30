#!/usr/bin/env bash
# Creates the stream server (Ampere A1, Oracle Linux 9) and keeps trying while OCI has no free capacity.
# Needs the OCI CLI, set up on this computer with `oci setup config`.
# Fill in the OCIDs below (see the notes at the end), then run: bash create-stream-instance.sh
set -u

COMPARTMENT_ID="ocid1.compartment.oc1..xxxxxxxx"   # the compartment (root = neoneoneogames)
AD_NAME="HOpZ:AP-MUMBAI-1-AD-1"                     # the availability domain shown in the console
IMAGE_ID="ocid1.image.oc1.ap-mumbai-1.xxxxxxxx"     # Oracle Linux 9, aarch64 (for A1)
SUBNET_ID="ocid1.subnet.oc1.ap-mumbai-1.xxxxxxxx"   # the public subnet (subnet-20260929-2235)
SSH_PUB_FILE="$HOME/.ssh/stream-server.pub"         # the public key; keep the private key safe
DISPLAY_NAME="stream-server"
OCPUS=1
MEMORY_GB=6
RETRY_SECONDS=600                                   # how long to wait between tries (10 minutes)

while true; do
  echo "$(date '+%F %T') trying to create $DISPLAY_NAME"
  if out=$(oci compute instance launch \
      --compartment-id "$COMPARTMENT_ID" \
      --availability-domain "$AD_NAME" \
      --shape VM.Standard.A1.Flex \
      --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
      --image-id "$IMAGE_ID" \
      --subnet-id "$SUBNET_ID" \
      --assign-public-ip true \
      --display-name "$DISPLAY_NAME" \
      --ssh-authorized-keys-file "$SSH_PUB_FILE" \
      --wait-for-state RUNNING 2>&1); then
    echo "created:"
    echo "$out" | grep -o '"display-name": *"[^"]*"\|"lifecycle-state": *"[^"]*"' || true
    echo "Now look up the public IP in the console (Compute > Instances > $DISPLAY_NAME)."
    exit 0
  fi
  if grep -qi "out of host capacity\|out of capacity" <<<"$out"; then
    echo "no capacity yet; waiting $RETRY_SECONDS seconds"
    sleep "$RETRY_SECONDS"
  else
    echo "stopped: this is not a capacity problem, so retrying will not help:"
    echo "$out"
    exit 1
  fi
done
