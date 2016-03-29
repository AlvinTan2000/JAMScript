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
    js->cstate = core_init(1000);

    // Callback initialization
    js->callbacks = callbacks_new();

    // Queue initialization
    // globalinq is used by the main thread for input purposes
    // globaloutq is used by the main thread for output purposes
    js->atable->globalinq = queue_new(true);
    js->atable->globaloutq = queue_new(true);

    bzero(&(js->atable->globalsem), sizeof(Rendez));

    // Start the event loop in another thread.. with cooperative threads.. we
    // to yield for that thread to start running
    taskcreate(jam_event_loop, js, STACKSIZE);

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
    int val;

    // get the mask
    char *fmask = activity_get_mask(js->atable, aname);

    cbor_item_t *arr = cbor_new_indefinite_array();
    cbor_item_t *elem;

    va_start(args, aname);

    while(*fmask)
    {
        elem = NULL;
        switch(*fmask++)
        {
            case 's':
                elem = cbor_build_string(va_arg(args, char *));
                break;
            case 'i':
                val = va_arg(args, int);
                elem = cbor_build_uint32(abs(val));
                if (val < 0)
                    cbor_mark_negint(elem);
                break;
            case 'd':
            case 'f':
                elem = cbor_build_float8(va_arg(args, double));
                break;
            default:
                break;
        }
        if (elem != NULL)
            assert(cbor_array_push(arr, elem) == true);
    }
    va_end(args);

    jactivity_t *jact = activity_new(js->atable, aname);
    command_t *cmd = command_new_using_cbor("REXEC", "SYNC", aname, jact->actid, arr);
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
    int val;

    // get the mask
    char *fmask = activity_get_mask(js->atable, aname);

    cbor_item_t *arr = cbor_new_indefinite_array();
    cbor_item_t *elem;

    va_start(args, aname);

    while(*fmask)
    {
        elem = NULL;
        switch(*fmask++)
        {
            case 's':
                elem = cbor_build_string(va_arg(args, char *));
                break;
            case 'i':
                val = va_arg(args, int);
                elem = cbor_build_uint32(abs(val));
                if (val < 0)
                    cbor_mark_negint(elem);
                break;
            case 'd':
            case 'f':
                elem = cbor_build_float8(va_arg(args, double));
                break;
            default:
                break;
        }
        if (elem != NULL)
            assert(cbor_array_push(arr, elem) == true);
    }
    va_end(args);

    // Need to add start to activity_new()
    jactivity_t *jact = activity_new(js->atable, aname);
    command_t *cmd = command_new_using_cbor("REXEC", "SYNC", aname, jact->actid, arr);
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

    for (i = 0; i < js->cstate->retries; i++)
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

void jam_set_timer(jamstate_t *js, uint64_t actid, int timerval)
{


}

int jam_get_timer_from_reply(command_t *cmd)
{

    return 0;
}


void taskmain(int argc, char **argv)
{
    jamstate_t *js = jam_init();
    return;
}
