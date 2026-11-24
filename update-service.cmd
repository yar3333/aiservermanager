git pull
call npm run build

@rem node backend\dist\cli.js install --host 0.0.0.0

net stop aiservermanager
net start aiservermanager
