#include <unistd.h>
#include "jdata.h"
#include "command.h"
#include "jam.h"

typedef char* jcallback;
char app_id[256] = { 0 };
jamstate_t *js;
jbroadcaster *y;

int user_main() {
    char buf[8];
    for (int i = 0; ; i++) {
        sprintf(buf, "%d", i);
        jamdata_log_to_server("global", "x", buf, ((void*)0));
        sleep(2);
        printf("%d\n", (int)get_jbroadcaster_value(y));
    }
}

void user_setup() {
    y = jbroadcaster_init(JBROADCAST_STRING, "y", NULL);
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
