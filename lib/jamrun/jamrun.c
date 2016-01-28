/*
The MIT License (MIT)
Copyright (c) 2015 Muthucumaru Maheswaran

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

#include <stdio.h>
#include <sys/wait.h>
#include "jamrun.h"
#include "jxereader.h"

/**
 * Define some global variables..
 * This is used to store values from args
 * NOTE the C files must have a 
 */
//

runner_config rconfig;

jam_service * open_jam_service(){
	//This is a dummy jam service, since the actual service is still not finished yet
	//the implementation will be changed depending on the real jservice so you can ignore this code
	jam_service * ret;

	printf("JAM SERVICE INITIATING.....\n");
	/*
	for(i = 0; i < 10; i++){
		dummy_put("HELLO");
		if((timestamp = dummy_get()) != NULL){
			quit = 0;
			break;
		}
	}

	if(quit){
		printf("JAM SERVICE CONNECTION FAILURE\n.... Exiting ....\n");
		exit(1);
	}
	*/
	ret = (jam_service *)calloc(1, sizeof(jam_service));
	if(ret == NULL){
		printf("Memory Malloc Failed\n");
		exit(1);
	}
	ret->timestamp = time(NULL);
	printf("CONNECTION ESTABLISHED.... at time %d\n", ret->timestamp);
	return ret;
}

/**
 * Define the main function..
 */
int main(int ac, char *av[])
{
	// Use the command line arguments to setup the runner's configuration
	int c_num, pid;
    setup_program(ac, av);

	print_config(&rconfig);

	// Access the JAMService deamon.. if not accessible then quit
	open_jam_service(); //open jam should quit automatically if failure
	// Open the JAMScript executable. If file not found or malformed, then quit with error!

	jxe_file *jxe = open_jam_executable(rconfig.file_name, 1);
	//This returns NULL for failure -> Error msg printed in open_jam
	if(jxe == NULL){ 
		return 1;
	}

	//So now we decide which mode we are going for 
	if(rconfig.c_mode){ 
		//Will print out how many c-nodes ran -> this is still kind of iffy since it requires specific format for manifest file
		printf("Initializing C-Mode\n");
		printf( "Number of c nodes run [%d]\n", c_num = load_jxe_cprog(jxe)); 
    }
    else if(rconfig.js_mode){
    	//NO clue what to do here
    	printf("Initializing JS-Mode\n");
    	jxe_load_js_file(jxe);
    }
    else{
    	//Run JS-Mode
    	pid = fork();
    	if(pid == 0)
    	{	
    	printf("Initializing JS-Mode\n");
    		jxe_load_js_file(jxe);
    	}//Run C-Mode
    	else{
    		printf("Initializing C-Mode\n");
    		printf("Number of c nodes run [%d]\n", c_num = load_jxe_cprog(jxe));
    		if(c_num != rconfig.proc_count){
    			printf("Expected proc count = %d, we ended running %d... \n", rconfig.proc_count, c_num);
    		}
    		wait(NULL);
    	}
    }
    printf("Exiting...\n");
    free_jxe(jxe); //Free the allocated file
    return 0;
	// If s-mode, we need to run both C and JS nodes. Start one JS node and then
//	if (rconfig.s_mode == 1)
}

/**
 * Get the command line arguments processed. This processing is done according to the "Option"
 * struction defined above. We parse the command line arguments and set the runner_config.
 * If the specified command line arguments are inconsistent, we exit (fail) with an error message.
 */

void setup_program(int ac, char *av[])
{
	//Well we have our args so we set up the stuff
	// So we are going to set up a strict version of this input args
	// jamrun -type filename -procs -machine -key where procs, machine and key are optional
	int length;
	if(ac < 3){
		printf("Please Input Arguments when running Jamrun\n jamrun -type filename -procs -machine -key\n procs, machine and key are optional\n");
		exit(1);
	}
	if(av[1][0] == '-'){
		if(av[1][1] == 'c')
			rconfig.c_mode = 1;
		else if(av[1][1] == 'j')
			rconfig.js_mode = 1;
		else if(av[1][1] == 's')
			rconfig.s_mode = 1;
		else{
			printf("Invalid Mode\nPlease enter jamrun -type filename -procs -machine -key\n");
			exit(1);
		}
	}
	else{
		printf("Please enter an option -c, -j or -s\n");
		exit(1);
	}
	length = strlen(av[2]);
	if(length < 4){
		printf("\n Please enter an appropriate filename ending in .jxe\n");
	}
	else{
		if(av[2][length - 4] == '.' && av[2][length - 3] == 'j' && av[2][length - 2] == 'x' && av[2][length - 1] == 'e' ){
			rconfig.file_name = calloc(length + 1, sizeof(char));
			if(rconfig.file_name == NULL){
				printf("Mem Alloc Failed\n");
				exit(1);
			}
			strcpy(rconfig.file_name, av[2]);
		}
		else{
			printf("\nPlease enter an appropriate filename ending in .jxe\n");
			exit(1);
		}
	}

	//Now process the file name



	/*
	int indx;

	prog_init();
	prog_set_syntax("[options] JAMScript_executable (.jxe)");
	prog_set_options(options);
	prog_set_version("0.1");
	prog_set_date("20151017");
	prog_set_author("Muthucumaru Maheswaran <maheswar@cs.mcgill.ca>");
	prog_set_contact(prog_author());
	prog_set_url("http://www.cs.mcgill.ca/~anrl/jamscript/");
	prog_set_desc("JAMScript executable loader for running JAMScript programs in different modes.");

	prog_set_verbosity_level(1);

	indx = prog_opt_process(ac, av);

	if (indx < ac)
		rconfig.file_name = strdup(av[indx]);
	else {
		prog_usage_msg("\n[setup_program]:: file name missing! \n\n");
		exit(1);
	}

	// Why do we need to set the program name.. don't know!
	prog_set_name("jamrun");
	/**
	 * Do Consistency Checks..
	 * Only one mode could be specified. Process count is valid only in single mode
	 * Machine name is necessary in the c and js modes.
	 */
	 /*
	if (rconfig.c_mode + rconfig.js_mode + rconfig.s_mode != 1) {
		prog_usage_msg("\n[setup_program]:: need to select exactly one mode: C, JS, or S\n\n");
		exit(1);
	}
	if (rconfig.s_mode != 1 && rconfig.proc_count > 0) {
		prog_usage_msg("\n[setup_program]:: process count only valid in S-mode\n\n");
		exit(1);
	}
	*/
}


/**
 * Print the configuration we have for the jamrun
 */

void print_config(runner_config *c)
{
	printf("\nConfiguration parameters... \n\n");
	printf("\nMachine name:\t %s", c->mach_name);
	printf("\nFile name: \t %s", c->file_name);
	printf("\nKey value: \t %s", c->key_value);
	printf("\nJ mode: \t %d", c->js_mode);
	printf("\nC mode: \t %d", c->c_mode);
	printf("\nS mode: \t %d", c->s_mode);
	printf("\nProc count: \t %d", c->proc_count);
	printf("\n.. End\n");
}

/**
 * Get the command line arguments, validate them, create a global config structure
 * Access the JAMService, if not accessible, print out an error and quit the program
 * Open the JAMScript executable file. If not found, print out an error and quit the program
 * If the file is found, validate the file for proper JAMScript executable
 *
 * If C client, connect to the machine. Ask the JAMService for a connection to the machine.
 * The connection is the JS node, so connect to it
 * If JS node, deploy the JS node, and register with the JAMService.
 * If standalone (own C and JS nodes), just run a JS instance and create many C instances
 * connect all the C instances to the JS instance. We are given the number of C instances.
 * We are done.
 *
 */
