
jasync logdata() {
    char buf[1000];

    // To make the J node subscribe in time
    sprintf(buf, "test");
    name = buf;
    jsleep(1000);

    // Log the timestamp for each data
    unsigned long long timestamp;
    for (int i = 1; i <= 1e1; i++) {
    	timestamp = ms_time();
      // Do at least this amount of work
      for(int j = 1; j <= 10; j++){
      	sprintf(buf, "%d-%llu-%d",i,timestamp,j);
      	name = buf;
      }
    }
}


int main(){logdata();}
