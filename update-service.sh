#!/usr/bin/bash

git pull
npm run build
sudo systemctl restart aiservermanager
