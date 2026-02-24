#!/usr/bin/env bash

#ngrok config add-authtoken 2tB3H7jpfafMVvGySwgpQ0Wq9s7_7r9NTy8t9HLffuBqsVq2u

set -a
source .env


ngrok http --url=$NGROK_URL 3000

# ngrok http $NGROK_URL



 #https://7b26-23-243-16-217.ngrok-free.app
