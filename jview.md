---
layout: page
title: JView
subtitle: JView Documentation
---

## JView

### Controllers
Controllers are widgets that are capable of sending commands to the backend and control. They are part of the output side of JView. These widgets have different configurations possible to bring a variety of control over a JAMScript program from an arbitrary web browser. All widgets are made in ReactJS and can be customizable inside the Config.json file.

There are currently 4 types of widgets: a slider, a button, a multistate button and a terminal. The slider and button have several modes to personalize the way the data is sent to the backend. The multistate button is similar to a button, but can emit different values depending on the state it is currently in. Finally, the terminal is a simple abstraction of an actual machine's own terminal capable of sending commands to and receiving responses from it.

#### Widgets

All widgets are associated to the ControllerStore which governs the values and state of each widget. There must be a MobX store associated with the widgets in order for them to function. This store is automatically generated through the StoreGenerator.js with the appropriate Config.json file. They emit to the backend through a websocket.

##### Slider

The slider is a simple HTML5 input element that can be controlled by clicking on its dial and sliding it left or right. Users can customize the slider's range by inputting a **min** value and a **max** value. In addition, its **step** can be changed to specify a specific increment whenever the dial is moved. The slider's initial **value** can also be customized to give the slider a specific value when it is first rendered. 

The slider widget possesses two modes. Its first mode will emit its new value whenever it is moved. The second mode will emit the current value every **interval** of time specified in milliseconds. Moving the slider in the second mode will not stream to the backend until the next interval of time.

###### Example

```shell
// Full example can be found in sample 9.
...
{
	"controlList": [
		{
			"id": "1",
			"type": "slider",
			"dispLabel": "The slider's name",
			"max": "maxValueName", // This is a string that refers to the variable in the store
			"min": "minValueName", // This is a string that refers to the variable in the store
			"step": "stepValueName", // This is a string that refers to the variable in the store
			"value": "presentValueName", // This is a string that refers to the variable in the store
			"valueName": "presentValueName", // This is a string that refers to the variable in the store
			"trigger": "emitValue", // Callback. This specific one will emit to the backend
			"mode": 0, // 0: triggers on change 1: triggers every interval
			"interval": 500 // Interval in milliseconds. Inactive if mode = 0
		}
	],
	"store": {
		"maxValueName": 100,
		"minValueName": 0,
		"stepValueName": 5,
		"presentValueName": 50
	}
}
...
```

The above is an example of the configuration necessary for a slider, in the _Config.json_ file. The store values will be placed in the _ControllerStore.js_' map property. The store is necessary to make the button work. The **trigger** property contains the callback of the slider. **emitValue** (See _StoreGenerator.js_) is a predefined one that will send a message of the shape below through a web socket.

```shell
// Example of what the slider emits to the backend
{
	"id": "1",
	"value": 50 // The value is the value at the new position of the slider.
}
```

##### Button

The button emits to the backend a boolean value and alternates between the values of **true** and **false**.

Like the slider, the button also has two modes. Similarly, the first mode will emit a boolean whenever it is pressed, while the second mode will emit its current state every **interval** of time specified in milliseconds. Only pressing the button will change its value.

###### Examples

```shell
// Full example can be found in sample 9 and 10.
...
{
	"controlList": [
		{
			"id": "1",
			"type": "button",
			"dispLabel": "The button's name",
			"className": "btn-primary", // refer to bootstrapJS doc
			"value": "presentValueName", // This is a string that refers to the variable in the store
			"valueName": "presentValueName", // This is a string that refers to the variable in the store
			"trigger": "emitValue", // Callback. This specific one will emit to the backend
			"disabled": "disabledStateName" 
			"mode": 0, // 0: triggers on change 1: triggers every interval
			"interval": 500 // Interval in milliseconds. Inactive if mode = 0
		}
	],
	"store": {
		"presentValueName": true // boolean only
		"disabledStateName": false // boolean only. Button is disabled if true.
	}
}
...
```

```shell
// Example of what the button emits to the backend
{
	"id": "1",
	"value": true // The value alternates between true and false.
}
```

##### Multistate Button

The multistate button is a button that can have more states than *true* or **false**. The button will NOT alternate between states on click. On the click event, it will emit whatever value is associated to the current state, as defined in the _Config.json_. **See sections below to see how to change the state of the button**.

###### Examples

```shell
// Full example can be found in sample 9 and 11.
...
{
	"controlList": [
		{
			"id": "1",
			"type": "multiStateButton",
			"dispLabel": "The button's name",
			"className": "btn-primary", // refer to bootstrapJS doc
			"states": [
				{
					"state_1": 1 // key is the name of the state. Value is the value emitted and can be anything
				},
				{
					"state_two": "some string" // The key will be on the button
				},
				{
					"On/Off": "5000" // The key can be any string. Key can be string/int
				}
			}
			]
			"trigger": "emitValue", // Callback. This specific one will emit to the backend,
			"state": "currentState" // This is a string that refers to the variable in the store
		}
	],
	"store": {
		"currentState": "state_1"
	}
}
...
```

```shell
// Example of what the multistate button emits to the backend
{
	"id": "1",
	"value": "some string" // The value can be anything specified in the Config.json file.
}
```

##### Terminal

The terminal uses a ReactJS component to simulate the real terminal, found [here](https://github.com/nitin42/terminal-in-react). On pressing the return key, the widget will emit the command along with the terminal's ID. **STDOUT** and **STDERR** will be sent back to the terminal when the command terminates.

###### Examples

```shell
// Full example can be found in sample 9 and 10.
...
{
	"controlList": [
		{
			"id": "1",
			"type": "multiStateButton",
			"dispLabel": "The button's name",
			"commandsList": "commands", // Refers to the variable in the store that holds the history of commands
			"buttonTrigger": "addCommand", // additional callBack. addCommand will add the command to the commandsList
			"trigger": "emitValue", // Callback. This specific one will emit to the backend
		}
	],
	"store": {
		"commands": []
	}
}
...
```

```shell
// Example of what the terminal emits to the backend
{
	"id": "1",
	"value": "./a.out" // The value is any string passed into the terminal.
}
```

##### Additional Comments

To add multiple widgets on the same page, simply add the widgets with a unique ID (string, or int) in the controlList. All store variables should have a unique name and values indicated in the store object. 

###### Backend

These widgets trigger the **emitValue** callback. This only emits a message through a websocket to the backend (see _NodeGenerator.js_). Should you want to do anything meaninful such as triggering unix command, do calculations, or trigger backend functions, The backend server should contain all these actions. For the sake of the samples (demos), the server, _jview/app/index.js_, generated by _NodeGenerator.js_ contains examples of how to deal with the messages in the backend. One can use the widget's unique ID to filter incoming messages and routing them accordingly to different functions.

###### Changing Values

As mentioned in the multistate button section, the backend can change any value contained in the controller store's map. This is due to the fact that the store will listen to the websocket **changeValue**. The example below shows the backend sending a message back to the store telling the button with id '2' to change it's disabled state to **true**

```shell
...
socket.on('emitValue', body => {
    console.log(body);
   	if (body.id === '2') {
        socket.emit('changeValue', {
            id: '2',
            name: 'disabledState1',
            value: true
        });
    }
});    
```

###### Samples
See sample-10 and the NodeGenerator.js from **line 165** to see how the two buttons start processes in the backend, terminates them and changes each other's values.

See sample-11 and the NodeGenerator.js from **line 203** to see how the multistate button can change state as well as start processes in the backend.

See sample-9 and the NodeGenerator.js from **line 102** to multiple widgets on a single page interracting with eachother. It should be noted that at **line 64**, there is an example of how to give custom commands to a widget. In this case, the button will change the multistate button to _state_3_ and this is not done through the backend or a websocket.

