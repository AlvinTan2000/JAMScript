jdata{
	int candidate1 as logger;
	int candidate2 as logger;
	int candidate3 as logger;
}

var notify = function(key, entry, device){
	// var name = device.
	var size = device.size();
	console.log("Received "+size+" votes");

	var lastData = device.lastData();
	var timestamp = JSON.parse(lastData).time_stamp;
	var lastValue = device.lastValue();

	console.log("Vote from "+lastValue+" at "+timestamp);

	var data = device.data();
	var values = device.values();

	if(device.size()>=10){
		var last10Data = device.n_data(10);
		console.log("Last 10 votes with time_stamp:",last10Data);
	}

	if(device.size()>=10){
		var last10Values = device.n_values(10);
		console.log("Last 10 votes are from", last10Values);
	}


	if(device.size()>20){
		// get the 21th value received
		var aValue = device.get_value_at(20);
		console.log("The 20th vote is from",aValue);
	}

	if(device.size()>20){
		// get the 10 values starting from the 6th one received
		var someValue = device.get_range_values(5, 10);
		console.log("The 5th to the 15th votes are from",someValue)
	}

	// year, month-1, date, hour, minute, secod
	var today = new Date(2017, 6, 19, 0, 0, 0);

	var dataToday = device.dataAfter(today);
	var valuesToday = device.valuesAfter(today);
	console.log("Received "+valuesToday.length+" data today");
	
	var timestamp = new Date(2017, 6, 20, 0, 0, 0);

	var dataYesterday = device.dataBetween(today, yesterday);
	var valueYesterday = device.valuesBetween(today, yesterday);
	console.log("Received "+valueYesterday.length+" data yesterday");
}

candidate1.subscribe(notify);
candidate2.subscribe(notify);
candidate3.subscribe(notify);