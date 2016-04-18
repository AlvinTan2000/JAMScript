/*

The MIT License (MIT)
Copyright (c) 2016 Muthucumaru Maheswaran

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY O9F ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

#include "jamlib.h"
#include "core.h"

#include <strings.h>
#include <pthread.h>

#define STACKSIZE                   30000



// Initialize the JAM library.. nothing much done here.
// We just initialize the Core ..
//
jamstate_t *jam_init()
{
    jamstate_t *js = (jamstate_t *)calloc(1, sizeof(jamstate_t));


    // TODO: Remove the hardcoded timeout values
    // 200 milliseconds timeout now set
    js->cstate = core_init(10000);
    if (js->cstate == NULL)
    {
        printf("ERROR!! Core Init Failed. Exiting.\n");
        exit(1);
    }

    // Callback initialization
    js->callbacks = callbacks_new();
    js->atable = activity_table_new();
    printf("Hi\n");

    // Queue initialization
    // globalinq is used by the main thread for input purposes
    // globaloutq is used by the main thread for output purposes
    js->atable->globalinq = queue_new(true);
    js->atable->globaloutq = queue_new(true);

    printf("Hi\n");
    bzero(&(js->atable->globalsem), sizeof(Rendez));

    // create the worker thread..
//    jam_create_bgthread(js);

    // Start the event loop in another thread.. with cooperative threads.. we
    // to yield for that thread to start running
    taskcreate(jam_event_loop, js, STACKSIZE);

    printf("End of Jam-lib\n");

    return js;
}

bool jam_create_bgthread(jamstate_t *js)
{
    int rval = pthread_create(&(js->bgthread), NULL, jamworker_bgthread, (void *)js);
    if (rval != 0) {
        perror("ERROR! Unable to start the jamworker thread");
        return false;
    }
    return true;
}


// Start the background processing loop.
//
//
void jam_event_loop(void *arg)
{
    jamstate_t *js = (jamstate_t *)arg;
    event_t *e = NULL;

    while ((e = get_event(js))) {
        if (e != NULL)
            callbacks_call(js->callbacks, js, e);
        else
            taskexit(0);

        taskyield();
    }
}


// TODO: This needs to revamped. Timeouts come here too.
// The RPC processing is complicated.. it could have changes here too.
// TODO: Add many different types of events here with the new design!
//
//
event_t *get_event(jamstate_t *js)
{
    nvoid_t *nv = queue_deq(js->atable->globalinq);
    command_t *cmd = command_from_data(NULL, nv);

    if (cmd == NULL)
        return NULL;

    if (cmd->cmd == NULL)
        return NULL;

    // TODO: Something should be done here...

    return NULL;
}


void jam_reg_callback(jamstate_t *js, char *aname, eventtype_t etype, event_callback_f cb, void *data)
{
    callbacks_add(js->callbacks, aname, etype, cb, data);
}


//
// TODO: Is there a better way to write this code?
// At this point, a big chunk of the code is replicated.. too bad
//
//
void *jam_rexec_sync(jamstate_t *js, char *aname, ...)
{
    va_list args;
    nvoid_t *nv;
    int i = 0;

    // get the mask
    char *fmask = activity_get_mask(js->atable, aname);
    arg_t *qargs = (arg_t *)calloc(strlen(fmask), sizeof(arg_t));

    cbor_item_t *arr = cbor_new_indefinite_array();
    cbor_item_t *elem;

    va_start(args, aname);

    while(*fmask)
    {
        elem = NULL;
        switch(*fmask++)
        {
            case 'n':
                nv = va_arg(args, nvoid_t*);
                elem = cbor_build_bytestring(nv->data, nv->len);
                qargs[i].val.nval = nv;
                qargs[i].type = NVOID_TYPE;
                break;
            case 's':
                qargs[i].val.sval = strdup(va_arg(args, char *));
                qargs[i].type = STRING_TYPE;
                elem = cbor_build_string(qargs[i].val.sval);
                break;
            case 'i':
                qargs[i].val.ival = va_arg(args, int);
                qargs[i].type = INT_TYPE;
                elem = cbor_build_uint32(abs(qargs[i].val.ival));
                if (qargs[i].val.ival < 0)
                    cbor_mark_negint(elem);
                break;
            case 'd':
            case 'f':
                qargs[i].val.dval = va_arg(args, double);
                qargs[i].type = DOUBLE_TYPE;
                elem = cbor_build_float8(qargs[i].val.dval);
                break;
            default:
                break;
        }
        i++;
        if (elem != NULL)
            assert(cbor_array_push(arr, elem) == true);
    }
    va_end(args);

    jactivity_t *jact = activity_new(js->atable, aname);
    command_t *cmd = command_new_using_cbor("REXEC", "SYNC", aname, jact->actid, arr, qargs, i);
    jam_rexec_runner(js, jact, cmd);

    if (jact->state == TIMEDOUT)
    {
        activity_del(js->atable, jact);
        return NULL;
    }
    else
    {
        activity_del(js->atable, jact);
        return jact->code->data;
    }
}


jactivity_t *jam_rexec_async(jamstate_t *js, char *aname, ...)
{
    va_list args;
    nvoid_t *nv;
    int i = 0;

    // get the mask
    char *fmask = activity_get_mask(js->atable, aname);
    arg_t *qargs = (arg_t *)calloc(strlen(fmask), sizeof(arg_t));

    cbor_item_t *arr = cbor_new_indefinite_array();
    cbor_item_t *elem;

    va_start(args, aname);

    while(*fmask)
    {
        elem = NULL;
        switch(*fmask++)
        {
            case 'n':
                nv = va_arg(args, nvoid_t*);
                elem = cbor_build_bytestring(nv->data, nv->len);
                qargs[i].val.nval = nv;
                qargs[i].type = NVOID_TYPE;
                break;
            case 's':
                qargs[i].val.sval = strdup(va_arg(args, char *));
                qargs[i].type = STRING_TYPE;
                elem = cbor_build_string(qargs[i].val.sval);
                break;
            case 'i':
                qargs[i].val.ival = va_arg(args, int);
                qargs[i].type = INT_TYPE;
                elem = cbor_build_uint32(abs(qargs[i].val.ival));
                if (qargs[i].val.ival < 0)
                    cbor_mark_negint(elem);
                break;
            case 'd':
            case 'f':
                qargs[i].val.dval = va_arg(args, double);
                qargs[i].type = DOUBLE_TYPE;
                elem = cbor_build_float8(qargs[i].val.dval);
                break;
            default:
                break;
        }
        i++;
        if (elem != NULL)
            assert(cbor_array_push(arr, elem) == true);
    }
    va_end(args);

    // Need to add start to activity_new()
    jactivity_t *jact = activity_new(js->atable, aname);
    command_t *cmd = command_new_using_cbor("REXEC", "SYNC", aname, jact->actid, arr, qargs, i);
    temprecord_t *trec = jam_create_temprecord(js, jact, cmd);
    taskcreate(jam_rexec_run_wrapper, trec, STACKSIZE);

    return jact;
}

temprecord_t *jam_create_temprecord(jamstate_t *js, jactivity_t *jact, command_t *cmd)
{
    temprecord_t *trec = (temprecord_t *)calloc(1, sizeof(temprecord_t));
    trec->jstate = js;
    trec->jact = jact;
    trec->cmd = cmd;

    return trec;
}

void jam_rexec_run_wrapper(void *arg)
{
    temprecord_t *trec = (temprecord_t *)arg;
    jam_rexec_runner(trec->jstate, trec->jact, trec->cmd);
    free(trec);
}


void jam_rexec_runner(jamstate_t *js, jactivity_t *jact, command_t *cmd)
{
    int i = 0;
    bool connected = false;
    bool processed = false;
    command_t *rcmd;

    for (i = 0; i < js->cstate->conf->retries; i++)
    {
        queue_enq(jact->outq, cmd->buffer, cmd->length);
        tasksleep(&(jact->sem));

        nvoid_t *nv = queue_deq(jact->inq);
        rcmd = command_from_data(NULL, nv);
        if (rcmd != NULL)
        {
            connected = true;
            break;
        }
        nvoid_free(nv);
    }

    // Mark the state as TIMEDOUT if we failed to connect..
    if (!connected)
    {
        command_free(rcmd);
        jact->state = TIMEDOUT;
        return;
    }

    for (i = 0; i < js->maxleases && !processed; i++)
    {
        int timerval = jam_get_timer_from_reply(rcmd);
        command_free(rcmd);
        jam_set_timer(js, jact->actid, timerval);
        tasksleep(&(jact->sem));

        nvoid_t *nv = queue_deq(jact->inq);
        rcmd = command_from_data(NULL, nv);

        if (strcmp(rcmd->cmd, "TIMEOUT") == 0) {
            command_t *lcmd = command_new("STATUS", "LEASE", jact->name, jact->actid, "");
            queue_enq(jact->outq, lcmd->buffer, lcmd->length);
            command_free(lcmd);
            tasksleep(&(jact->sem));

            nvoid_t *nv = queue_deq(jact->inq);
            rcmd = command_from_data(NULL, nv);
            continue;
        }
        else
        if (strcmp(rcmd->cmd, "REXEC") == 0 &&
            strcmp(rcmd->opt, "COMPLETE") == 0) {
            // return code already retrived by the command parser
            processed = true;
            break;
        }
        else
        if (strcmp(rcmd->cmd, "REXEC") == 0 &&
            strcmp(rcmd->opt, "ERROR") == 0) {
            // return code already retrived by the command parser
            processed = true;
            break;
        }
    }

    if (!processed)
    {
        // activity timed out..
        jact->state = TIMEDOUT;
        // It is taking way too long to run at the J-core
        // Send a kill commmand...
        command_t *kcmd = command_new("REXEC", "KILL", jact->name, jact->actid, "");
        queue_enq(jact->outq, kcmd->buffer, kcmd->length);
        command_free(kcmd);
    }

    // TODO: How to delete an async activity that was timedout?
}


bool jam_ping_jcore(socket_t *sock, int timeout)
{
    command_t *scmd;

    // create a request-reply socket
    scmd = command_new("PING", "DEVICE", "dfsdfsdfsdf",
                        "dfdfds", "");

    socket_send(sock, scmd);
    command_free(scmd);
    command_t *rcmd = socket_recv_command(sock, timeout);

    if (rcmd == NULL)
        return false;
    else
    {
        if (strcmp(rcmd->cmd, "PONG") == 0)
        {
            command_free(rcmd);
            return true;
        }
        else
        {
            command_free(rcmd);
            return false;
        }
    }
}



void jam_set_timer(jamstate_t *js, char *actid, int timerval)
{


}

int jam_get_timer_from_reply(command_t *cmd)
{

    return 0;
}


void taskmain(int argc, char **argv)
{
    // jamstate_t *js = jam_init();
    jamstate_t *js = jam_init();


    int i, error = 0;

    printf("Sending pings to %s at port %d\n", js->cstate->conf->my_fog_server, js->cstate->conf->port);

//    socket_t *sock = socket_new(SOCKET_REQU);
//    socket_connect(sock, js->cstate->conf->my_fog_server, js->cstate->conf->port);



    for (i = 0; i < 100000; i++) {
        bool res = jam_ping_jcore(js->cstate->reqsock, 1000);
//        bool res = jam_ping_jcore(sock, 1000);

        if (!res) error++;
        if (res) printf("+ i = %d", i); else printf("-");
    }

    if (error > 0)
        printf("%d pings out of 1000 were lost\n", error);
    else
        printf("All pings replied..\n");

    return;
}
