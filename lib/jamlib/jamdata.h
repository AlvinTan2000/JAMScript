#ifndef __JAMDATA_H__
#define __JAMDATA_H__

#include <stdlib.h>
#include <hiredis/hiredis.h>
#include <hiredis/async.h>

#include <hiredis/adapters/libevent.h>
#include <semaphore.h>
#include <cbor.h>

#include "jam.h"
#include "activity.h"
#include <string.h>
#include <unistd.h>

#include <stdarg.h>
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

#include "cborutils.h"

#define DELIM "$$$"
#define DEFAULT_APP_NAME "APP"
#define DEFAULT_SERV_IP "127.0.0.1"
#define DEFAULT_SERV_PORT 6379

typedef void (*connection_callback_f)(const redisAsyncContext *c, int status);
typedef void (*msg_rcv_callback_f)(redisAsyncContext *c, void *reply, void *privdata);

typedef struct jbroadcaster
{
    char *key;
    void *data;
#ifdef linux
    sem_t lock;
#elif __APPLE__
    sem_t *lock;
#endif
    activitycallback_f usr_callback;
    enum
    {
        JBROADCAST_INT,
        JBROADCAST_STRING,
        JBROADCAST_FLOAT
    } type;
    threadsem_t *write_sem;
    redisAsyncContext *context;

} jbroadcaster;


typedef struct jdata_list_node
{
    union
    {
        jbroadcaster *jbroadcaster_data;
    } data;
    struct jdata_list_node *next;

} jdata_list_node;


void jamdata_def_connect(const redisAsyncContext *c, int status);
void jamdata_def_disconnect(const redisAsyncContext *c, int status);
void *jamdata_init(void *jsp);
char *jamdata_makekey(char *ns, char *lname);
void __jamdata_logto_server(redisAsyncContext *c, char *key, char *val, msg_rcv_callback callback, int iscbor);
void jamdata_logger_cb(redisAsyncContext *c, void *reply, void *privdata);
char *jamdata_encode(char *fmt, ...);
void* jamdata_decode(char *fmt, char *data, int num, void *buffer, ...);
void jamdata_log_to_server(char *ns, char *lname, char *value, int iscbor);

redisAsyncContext *jamdata_subscribe_to_server(char *key, msg_rcv_callback on_msg, connection_callback_f connect, connection_callback_f disconnect);
void free_jbroadcaster(jbroadcaster *j);
jbroadcaster *jambroadcaster_init(int type, char *namespace, char *broadcaster_name, activitycallback_f usr_callback);
jbroadcaster *jbroadcaster_init(int type, char *variable_name, activitycallback_f usr_callback);
void msg_rcv_usr_callback(void *ten, void *arg);
void jbroadcaster_msg_rcv_callback(redisAsyncContext *c, void *reply, void *privdata);
void *get_jambroadcaster_value(jbroadcaster *j);


#endif
