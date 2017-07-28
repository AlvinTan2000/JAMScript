---
layout: page
title: Install
subtitle: Installing JAMScript on Linux
---

## Preparing your system (Ubuntu)    

Please make sure you have the latest Node.js (> 8.0.0) and npm (> 5.0.0) installed on your system.
If you an older version, please manually remove it. 
Install dependencies:  
```shell
./depend-install-ubuntu.sh
```  
This will install all the dependencies, including the newest Node.js on your system.  

Configure node_modules path:
```shell
vi ~/.bashrc
add the following line:
export NODE_PATH=$HOME/node_modules:/usr/local/lib/node_modules:$NODE_PATH
save file and quit
source .bashrc
```  
  
Install JAMScript:
```shell
./jamscript-install.sh
```

Run `which jamc` to verify that JAMScript compiler installed on your system. It should show the location of jamc.

## Preparing your Raspberry Pi

Not yet tested. It is best to cross compile JAMScript to Raspberry Pi although
RPI3 is powerful enough to compile JAMScript.

## Preparing your Arduino Yun

Definitely need a JAMScript cross compiler.
Need testing and documentation.