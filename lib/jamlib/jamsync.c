#include "jam.h"
#include "core.h"

#include <strings.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include "free_list.h"

//
// This is running remote function synchronously.. so we wait here
// for the reply value. We use the reply value from the root of the sub tree.
// All other return values are ignored. The root of the subtree should respond. 
// If it fails to respond, we quit with an error. 
//
//
arg_t *jam_rexec_sync(jamstate_t *js, char *aname, char *fmask, ...)
{
    va_list args;
    nvoid_t *nv;
    int i = 0;
    arg_t *qargs;
    arg_t *rargs;

    assert(fmask != NULL);
    if (strlen(fmask) > 0)
        qargs = (arg_t *)calloc(strlen(fmask), sizeof(arg_t));
    else
        qargs = NULL;

    cbor_item_t *arr = cbor_new_indefinite_array();
    cbor_item_t *elem;
    struct alloc_memory_list *list = init_list_();

    va_start(args, fmask);

    while(*fmask)
    {
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
        if (elem){
            assert(cbor_array_push(arr, elem) == true);
            add_to_list_(elem, list);
          }
    }
    va_end(args);
    jactivity_t *jact = activity_new(js->atable, activity_gettime());

    if (jact != NULL)
    {
        // Get the root condition string. This string forces the command to execute at the root only 
        char *rootcond = get_root_condition(js);
        command_t *cmd = command_new_using_cbor("REXEC-SYN", rootcond, aname, jact->actid, js->cstate->device_id, arr, qargs, i);
        cmd->cbor_item_list = list;
    
        command_t *bcmd = command_new_using_cbor("REXEC-SYN", "true", aname, jact->actid, js->cstate->device_id, arr, qargs, i);
        bcmd->cbor_item_list = list;
        rargs = jam_sync_runner(js, jact, rootcond, cmd, bcmd);
        activity_free(jact);
        return rargs;
    } 
    else
        return NULL;
}


// The Sync Runner does the following:
// Launch the command with the condition that it should only run in the root. 
// Wait for the reply. Fail if no reply.
// If successful reply, then we run the command everywhere else. 
// 
//
arg_t *jam_sync_runner(jamstate_t *js, jactivity_t *jact, char *rcond, command_t *cmd, command_t *bcmd)
{
    command_t *rcmd;
    arg_t *repcode;
    int error_count = 0;
    char *actname = strdup(cmd->actname);

    insert_runtable_entry(js, cmd);
    runtableentry_t *act_entry = find_table_entry(js->rtable, cmd);
    #ifdef DEBUG_LVL1
        printf("Starting JAM exec runner... \n");
    #endif

    if (act_entry == NULL)
    {
        jact->state = FATAL_ERROR;
        return NULL;
    }

    // Send the command to the remote side  
    // The send is executed via the worker thread..
    queue_enq(jact->thread->outq, cmd, sizeof(command_t));

    // We expect act_entry->num_replies from the remote side 
    // The replies are just confirmations on REXEC-SYN execution
    //
    for (int i = 0; i < act_entry->num_replies; i++)
    {
        // TODO: Fix the constant 300 milliseconds here..
        jam_set_timer(js, jact->actid, 300);
        nvoid_t *nv = pqueue_deq(jact->thread->inq);
        jam_clear_timer(js, jact->actid);

        rcmd = NULL;
        if (nv != NULL)
        {
            rcmd = (command_t *)nv->data;
            free(nv);

            if ((strcmp(rcmd->cmd, "TIMEOUT") == 0) || (strcmp(rcmd->cmd, "REXEC-NAK") == 0))
                error_count++;
            else 
                jact->replies[i - error_count] = rcmd;
        }
    }        

    // return.. all invocation requests have failed..
    if (error_count == act_entry->num_replies)
        return NULL;
    
    // Start the invocation for the second time.. the root has already started the execution 
    // this is for the other nodes.. the root should ignore this because it is a duplicate
    queue_enq(jact->thread->outq, bcmd, sizeof(command_t));

    // We create a structure to hold the result returned by the root
    repcode = (arg_t *)calloc(1, sizeof(arg_t));

    // We sleep for the lease time.. this is expected.. we are in "sync" call
    int stime = get_sleep_time(jact);

    // Send the request to get the results... 
    // TODO: Fix this to get an extension.. now we expect the results to be available 
    // after the lease time..
    command_t *lcmd = command_new("REXEC-RES-GET", rcond, actname, jact->actid, js->cstate->device_id, "");
    queue_enq(jact->thread->outq, lcmd, sizeof(command_t));

    // Now we retrive the replies from the remote side..
    // 
    for (int i = 0; i < act_entry->num_replies; i++)
    {
        jam_set_timer(js, jact->actid, stime);
        nvoid_t *nv = pqueue_deq(jact->thread->inq);
        jam_clear_timer(js, jact->actid);   

        // Next iteration we are not going to wait stime.. just a token amount of time timeout FASTER
        stime = 5;     
        rcmd = (command_t *)nv->data;
        free(nv);

        if (strcmp(rcmd->cmd, "REXEC-RES-PUT") == 0 && strcmp(rcmd->actarg, "RESULTS") == 0)
            command_arg_copy(repcode, &(rcmd->args[0]));

        command_free(rcmd);
    }

    free_rtable_entry(js->rtable, act_entry);
    return repcode;
}


int get_sleep_time(jactivity_t *jact)
{
    command_t *cmd;
    int i, timeout = 0;

    for (i = 0; i < 3; i++)
    {
        cmd = jact->replies[i];
        if ((cmd != NULL) && cmd->nargs == 1 && cmd->args[0].type == INT_TYPE) 
            timeout = MAX(timeout, cmd->args[0].val.ival);
    }

    return timeout;
}



char *get_root_condition(jamstate_t *js)
{
    char buf[256];

    if (js->cstate->mqttenabled[2])
        sprintf(buf, "machtype === \"CLOUD\"");
    else
    if (js->cstate->mqttenabled[1]) 
        sprintf(buf, "machtype === \"FOG\"");
    else 
        sprintf(buf, "machtype === \"DEVICE\"");

    return strdup(buf);
}