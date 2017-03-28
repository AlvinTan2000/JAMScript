#include <unistd.h>
#include "jdata.h"
#include "command.h"
#include "jam.h"
#include <stdio.h>
typedef char* jcallback;
jamstate_t *js;
void ping(){
printf("Ping receive...\n");
}
void callping(void *act, void *arg) {
command_t *cmd = (command_t *)arg;
ping();
}

int user_main() {
return 0;
}

void user_setup() {
activity_regcallback(js->atable, "ping", ASYNC, "", callping);
}

void jam_run_app(void *arg) {
user_main();
}

void taskmain(int argc, char **argv) {

    js = jam_init(1883);
    user_setup();
     
    taskcreate(jam_event_loop, js, 50000);
    taskcreate(jam_run_app, js, 50000);
  }
