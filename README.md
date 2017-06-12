[![Build Status](https://travis-ci.org/anrl/JAMScript.svg?branch=master)](https://travis-ci.org/anrl/JAMScript)

# JAMScript: A Language and Middleware for Cloud of Moving Things

## Overview

Cloud of Moving Things (CoMT) is a computing model that combines the widely popular
cloud computing with Internet of Things (IoT).
One of the major problems
with CoMT is the latency of accessing distant cloud resources from the
devices, where the data is captured. To address this problem, paradigms such
as fog computing and Cloudlets have been proposed to interpose another layer
of computing between the clouds and devices. Such a three-layered
cloud-fog-device computing architecture is touted as the most suitable
approach for deploying many next generation ubiquitous computing
applications. Programming applications to run on such a platform is quite
challenging because disconnections between the different layers are bound to
happen in a large-scale CoMT system, where the devices can be mobile.

JAMScript is a polglot programming language that combines C and JavaScript
for a three-layered CoT system. A proof-of-concept compiler and runtime for
different distributed systems are provided in this repository.
Our goal is to get JAMScript to work in many platforms so that heterogeneous
systems can be developed using it. You can see the associated publications to
learn about the whole concept.

This is an open source project. If you are interested in contributing towards this
project, we would be delighted to hear from you. Please contact maheswar@cs.mcgill.ca
for more information.

## Preparing your system (Ubuntu)    

Due to recent maintanence, some module version combinations may not work for jDATA. Here is one that works smoothly:
```
Redis:             3.2.6
Ubuntu (64-bit):   16.04.1
Node.js:           7.10.0
libhiredis-dev:    0.13.3-2
redis-fast-driver: 1.0.5
```

Using the Ubuntu package manager install the following packages.
```
sudo apt-get install xz-utils
sudo apt-get install texinfo
sudo apt-get install libc-dev
sudo apt-get install cmake
sudo apt-get install libhiredis-dev
sudo apt-get install libevent-dev
sudo apt-get install libbsd-dev
sudo apt-get install g++
```

Unfortunately, Ubuntu package distribution does not have the latest version for
all required software. So we need to install them manually.

scons version 2.5 or later is best. Following commands can be used to install
scons.
```
cd /tmp or a download directory
wget http://prdownloads.sourceforge.net/scons/scons-2.5.0.tar.gz
tar zxvf scons-2.5.0.tar.gz
cd scons-2.5.0
sudo python setup.py install
```

Check your node version. If you have a node that is 6.3.1 or later you can skip this
step. Here are the instructions for Node 6.5.0.
```
wget https://nodejs.org/dist/v6.5.0/node-v6.5.0-linux-x64.tar.xz
sudo tar -C /usr/local --strip-components 1 -xJf node-v6.5.0-linux-x64.tar.xz
```
You should have the NodeJS and NPM installed now.

Check whether your system has gcc 5 or newer. If not, you need to upgrade it
using the following commands.
```
sudo add-apt-repository ppa:ubuntu-toolchain-r/test
sudo apt-get update
sudo apt-get install gcc-5 g++-5

sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-5 1
```

JAMScript uses a slightly modified tcc. You can get tcc and install it as follows.
```
cd to your downloads directory
git clone http://github.com/wenger/tcc.git

cd tcc
./configure
make
sudo make install
```

Libcbor needs to be installed; use the following commands.
```
wget https://github.com/PJK/libcbor/releases/download/v0.4.0/libcbor-0.4.0-Linux.deb
sudo dpkg -i libcbor-0.4.0-Linux.deb
```

Install nanomsg using the following commands.
```
wget https://github.com/nanomsg/nanomsg/archive/1.0.0.tar.gz
tar zxvf 1.0.0.tar.gz
cd nanomsg-1.0.0
./configure
make
sudo make install
```

The JAMScript source has a slightly modified task library in the deps folder.
Run the following commands to install it.
```
cd deps/libtask
make
sudo make install
```

Now, you should have a system that can run the JAMScript compiler.

## Preparing your system (macOS)

JAMScript is already tested in macOS. We need to get the preparation instructions done for
it!

## Instructions for Raspberry Pi

sudo apt-get update
sudo apt-get install clang
sudo apt-get install xz-utils
sudo apt-get install texinfo
sudo apt-get install libc-dev
sudo apt-get install cmake
sudo apt-get install libhiredis-dev
sudo apt-get install libevent-dev
sudo apt-get install libbsd-dev
sudo apt-get install mosquitto

cd /tmp or a download directory
wget http://prdownloads.sourceforge.net/scons/scons-2.5.0.tar.gz
tar zxvf scons-2.5.0.tar.gz
cd scons-2.5.0
sudo python setup.py install


wget https://nodejs.org/dist/v7.0.0/node-v7.0.0-linux-armv6l.tar.xz
sudo tar -C /usr/local --strip-components 1 -xJf node-v7.0.0-linux-armv6l.tar.xz

wget https://github.com/PJK/libcbor/archive/v0.5.0.zip
extract then cd into the directory
cmake CMakeLists.txt
make
sudo make install

sudo apt-get install libssl-dev
git clone https://github.com/eclipse/paho.mqtt.c.git
cd paho.mqtt.c
make
sudo make install

wget http://download.redis.io/redis-stable.tar.gz
tar xvzf redis-stable.tar.gz
cd redis-stable
make
sudo make install

git clone http://github.com/wenger/tcc.git
cd tcc
./configure
make
sudo make install

wget https://github.com/nanomsg/nanomsg/archive/1.0.0.tar.gz
tar zxvf 1.0.0.tar.gz
cd nanomsg-1.0.0
./configure
make
sudo make install

There's an issue on ARM architecture with the original libtask, so here we use a
slightly modified version of it.
cd deps/libtask
make
sudo make install

cd lib/jserver
sudo npm install -g

cd
Use your favorite editor to edit .bashrc
add the following line:
export NODE_PATH=$HOME/node_modules:/usr/local/lib/node_modules:$NODE_PATH
save file and quit
source .bashrc

cd JAMScript
sudo npm install cbor
sudo npm install mime

sudo scons install


## Preparing your Arduino Yun

Definitely need a JAMScript cross compiler.
Need testing and documentation.

## Installing JAMScript

If everything is done according the previous instructions to prepare the system,
installing JAMScript is very simple; run the following commands.
```
cd into the JAMScript source directory (directory that contains this README.md)
scons
sudo scons install
```

#### (Optional) MQTT Mosquito 

If a problem of `Missing <MQTTClient.h>` exists while running command `scons`, you need to install `pahomqtt` library:

First, make sure you have 1.4.8 version of mosquitto installed:
```
sudo apt-get install mosquitto mosquitto-clients
```

Then, you need to manully add files from `pahomqtt` library to `/usr/include/` path:

1. Download C client for Unix from https://projects.eclipse.org/projects/technology.paho/downloads

2. Extract the files, and copy the include/ lib/ folders to your system directories (`/usr`)
```
sudo mv ./include /usr/include/
sudo mv ./lib /usr/lib/
```
3. Re-try with `scons` in JAMScript source directory and it should build successfully

Now, you should have the JAMScript compiler installed in the system. To verify whether
`jamc` got installed, run `which jamc`.


## Trying out the JAMScript compiler

### Running the example programs

JAMScript comes with a bunch of sample programs. You can cd into samples/chat
and run `jamc chat.c chat.js` to compile the program. You should see `chat.jxe` in
that directory.

A JAMScript executable has native (compiled C) and Node (JavaScript) components.
To run the C and J nodes use the following commands.
```
jamrun -c chat.jxe
jamrun -j chat.jxe
```

### Hello World

Need a simple program to illustrate JAMScript.


## More advanced JAMScript deployments
