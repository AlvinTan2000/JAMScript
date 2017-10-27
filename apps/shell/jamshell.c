#include <stdio.h>
#include <unistd.h>
#include<pthread.h>
#include<stdlib.h>
#include<unistd.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>

time_t start;
char* getNodeName();

// void* startJ(void *arg) {
// 	char command[100];
// 	strcpy(command, "node jamout.js --app=progA");
// 	printf("%s\n", command);
// 	int x = system(command);
// }

void* startC(void *arg) {
        char *args[5];

        args[0] = "a.out";
        args[1] = "-a";
        args[2] = "progA";
        args[3] = NULL;

        if (fork() == 0) {
          execvp("/Users/oryx/progA/a.out", args);
        }
}

jsync char* pwd() {
	char cwd[1024];
	return getcwd(cwd,sizeof(cwd));
}

jasync execProg() {

	pthread_t tidC;
	sleep(1);
	int errC;
	errC = pthread_create(&tidC, NULL, &startC, NULL);
	if(errC != 0) {
		printf("Could not create thread for exec C.\n");
	} else {
		printf("Exec C completed succesfully.\n");
	}	
	pthread_detach(tidC);
	jobs = "progA";
}

jsync int logInfo() {
	int elapsed = (int)(time(NULL) - start);
    info = {
    	.uptime: elapsed,
    	.nodeType: "NODE_TYPE",
    	.nodeName: getNodeName()
    };
    return 0;
}

int main() {
	start = time(NULL);
	printf("Node online.\n");
}