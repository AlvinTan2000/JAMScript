#include <unistd.h>
#include "jdata.h"
#include "command.h"
#include "jam.h"
#include <unistd.h>
char app_id[256] = { 0 };
char jdata_buffer[20];
typedef char* jcallback;
jamstate_t *js;
int user_main() {
for (int i = 0; ; i++) {
printf("Logging... \n");
sprintf(jdata_buffer, "%i", i);
jamdata_log_to_server("global", "x", jdata_buffer, ((void*)0));
sleep(1);
}
}

void user_setup() {
}

void jam_run_app(void *arg) {
user_main();
}

void taskmain(int argc, char **argv) {

    if (argc > 1) {
      strncpy(app_id, argv[1], sizeof app_id - 1);
    }
    js = jam_init(1883);
    user_setup();
     
    taskcreate(jam_event_loop, js, 50000);
    taskcreate(jam_run_app, js, 50000);
  }
