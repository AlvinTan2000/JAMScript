#include <stdio.h>
#include "cellulariot.h"

int main() {

    int *data;

    prinf("Accelerometer:\n")
    if (read_accel(int *data) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");

    prinf("ADC:\n")
    if (read_adc(int *data, 0) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");

    prinf("Ambient light:\n")
    if (read_lux(int *data) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");

    prinf("Temperature:\n")
    if (read_temp(int *data) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");

    prinf("Humidity:\n")
    if (read_hum(int *data) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");

    prinf("GPS:\n")
    if (read_gps(int *data) == 0)
        printf("\tRead successful. Data received: %i\n\n", *data);
    else
        printf("\tRead failed\n\n");
}