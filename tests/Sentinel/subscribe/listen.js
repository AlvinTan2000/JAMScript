
jdata {
    char *name as logger;
}

var timeList = [];    // Store the time difference for each entry
var counter = 0;

var callback = {
  notify: function (key, entry) {
        counter ++;

        // Calculate the timestamp for each 10 entries interval
        if (counter % 10 == 0){
          value = entry.log.split("-");
          timeList.push(+new Date() - parseInt(value[1]));    // Calculate and store time diff

          // Stop after this amount of entries, and calculate average time and variance
          if (counter == 1e3){
            var sum = timeList.reduce((a, b) => a + b, 0);
            var avg = sum/timeList.length;
            var ss = timeList.reduce((a,b) => a+ Math.pow((b - avg),2), 0)
            console.log("Average:", avg);
            console.log("Variance:", ss/(timeList.length-1));
          }
        }
      }
};


var interval = setInterval(function() {
	    if (name[1]) {
        clearInterval(interval);
        name[1].subscribe(callback);
      }
}, 0);
