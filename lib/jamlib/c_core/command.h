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

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

#ifdef __cplusplus
extern "C" {
#endif

#ifndef __COMMAND_H__
#define __COMMAND_H__

#include <cbor.h>
#include <stdint.h>

#include "nvoid.h"

/*
 * TODO: May be we could have user defined structures and unions in the
 * argument definitions. This would help serialization of arbitrary structures.
 * The challenge would be to transfer such data between C and JavaScript.
 */

enum argtype_t {
    STRING_TYPE,
    INT_TYPE,
    DOUBLE_TYPE,
    OTHER_TYPE
};

typedef struct _arg_t
{
    enum argtype_t type;
    union _argvalue_t
    {
        int ival;
        char *sval;
        double dval;
        void *oval;
    } val;
} arg_t;


/*
 * A structure to hold the outgoing and incoming command.
 * An outgoing command is parsed into a CBOR formatted byte array and similarly
 * a CBOR formatted byte array is decoded into a CBOR item handle.
 * Also, information is extracted from the CBOR item and inserted into the
 * command structure at the decoding process.
 */

typedef struct _command_t
{
    cbor_item_t *item;                      // handle to the CBOR array
    unsigned char *buffer;                  // CBOR byte array in raw byte form
    char *cmd;                              // Name of the command
    char *opt;
    char *actname;                        // Activity ID, where applicable
    arg_t *args;                            // List of args
    int length;                            // length of the raw CBOR data
    int nitems;                             // length of CBOR array

} command_t;


command_t *command_new_using_cbor(const char *cmd, char *opt, char *actname, cbor_item_t *arr);
command_t *command_new(const char *cmd, char *opt, char *actname, const char *fmt, ...);
command_t *command_from_data(char *fmt, nvoid_t *data);

void command_free(command_t *cmd);
void command_print(command_t *cmd);

#endif

#ifdef __cplusplus
}
#endif
