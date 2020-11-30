#!/bin/bash
xterm -e jamrun listen.jxe --cloud --app=xyz --data=127.0.0.1:8001 &
xterm -e jamrun listen.jxe --fog --app=xyz --data=127.0.0.1:7001 &
xterm -e jamrun listen.jxe --app=xyz
exit 0
