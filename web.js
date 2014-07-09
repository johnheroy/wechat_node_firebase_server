// app declarations
var express = require("express");
var weixin = require("weixin-api");
var connect = require("connect");
var request = require("request");
var app = express();
app.use(connect.json());
app.use(connect.urlencoded());

// wechat config, replace with your own variables
weixin.token = process.env.WEIXIN_TOKEN;
weixin.WEIXIN_HAO = process.env.WEIXIN_HAO;
weixin.refreshToken(process.env.APP_ID, process.env.APP_SECRET); // keep token updated every hour

// firebase declarations
var Firebase = require('firebase');
var fireRoute = new Firebase(process.env.FIREBASE_URL);
var messages = fireRoute.child('messages');
var users = fireRoute.child('users');

// authenticate signature
app.get('/', function(req, res) {
	console.log(typeof res);
    if (weixin.checkSignature(req)) {
        res.send(200, req.query.echostr);
    } else {
        res.send(200, 'error');
    }
});

// handle wechat subscription event
weixin.eventMsg(function(msg) {
	console.log(msg.event + " eventMsg received");

	var currentUserRef = users.child(msg.fromUserName);
	var resMsg = {};

	switch (msg.event) {
		case "subscribe" :
			currentUserRef.set({status: "no name"});
			resMsg = {
				fromUserName : msg.toUserName,
				toUserName : msg.fromUserName,
				msgType : "text",
				content : "Welcome to the demo! Before we begin, what's your name? (Note: please reply with your first name only)",
				funcFlag : 0
			};
			break;

		case "unsubscribe" :
			currentUserRef.remove();
			resMsg = {
				fromUserName : msg.toUserName,
				toUserName : msg.fromUserName,
				msgType : "text",
				content : "",
				funcFlag : 0
			};
			break;
	}

	weixin.sendMsg(resMsg);
});

// handle receive wechat text message event
weixin.textMsg(function(msg) {
    console.log("textMsg received");
    console.log(JSON.stringify(msg));

    var currentUserRef = users.child(msg.fromUserName);
    var resMsg = {};

    // verify the user, then proceed accordingly based on db
    currentUserRef.once('value', function(snapshot) {
		var userData = snapshot.val();
		if (userData.status === "no name") {
			currentUserRef.update({name: msg.content, status: "confirming"});
			var reply = "Your name is " + msg.content + ". Is that correct? (Note: please reply 'Yes' or 'No')";
			resMsg = {
                fromUserName : msg.toUserName,
                toUserName : msg.fromUserName,
                msgType : "text",
                content : reply,
                funcFlag : 0
            };
            weixin.sendMsg(resMsg);
		} else if (userData.status == "confirming") {
			switch (msg.content.toLowerCase()) {
				case "yes" :
					currentUserRef.update({status: "confirmed"});
					resMsg = {
		                fromUserName : msg.toUserName,
		                toUserName : msg.fromUserName,
		                msgType : "text",
		                content : "Great! I'll join you in with the chat now.",
		                funcFlag : 0
		            };
					break;

				case "no" :
					currentUserRef.update({status: "no name"});
					resMsg = {
		                fromUserName : msg.toUserName,
		                toUserName : msg.fromUserName,
		                msgType : "text",
		                content : "I'm sorry! Let's try again. What is your first name?",
		                funcFlag : 0
		            };
					break;

				default:
					var reply = "I'm sorry I didn't catch that. Just to confirm, is your name " + userData.name + "? (Note: please reply 'Yes' or 'No')";
					resMsg = {
		                fromUserName : msg.toUserName,
		                toUserName : msg.fromUserName,
		                msgType : "text",
		                content : reply,
		                funcFlag : 0
		            };
		            break;
			}
			weixin.sendMsg(resMsg);
		} else if (userData.status === "confirmed") {
		    var name = userData.name;
		    var text = msg.content;
		    messages.push({name: name, text: text, wechat: msg.fromUserName});
		    resMsg = {
		    	fromUserName : msg.toUserName,
		    	toUserName : msg.fromUserName,
		    	msgType : "text",
		    	content : "",
		    	funcFlag : 0
		    };
		    weixin.sendMsg(resMsg);
		} else {
			console.log("There was an error");
		}
	});
});

weixin.voiceMsg(function(msg) {
	console.log("voiceMsg received");
	console.log(JSON.stringify(msg));
});

// handle new firebase message event
messages.on('child_added', function(snapshot) {
	var message = snapshot.val();
	var msgRef = snapshot.ref();
	var formatted_message = message.name + " says: " + message.text;

	// go through all the users and see if it needs to be sent
	users.once('value', function(usersSnapshot) {
		usersSnapshot.forEach(function(userSnapshot) {
			var user = userSnapshot.val();
			var wechatId = userSnapshot.name();
			var read_by_user = "read_by_" + wechatId;
			if (!message[read_by_user] && (wechatId != message.wechat)) {
				console.log("Delivering the message to " + user.name);
				// if access token is undefined, wait 2 seconds
				if (!weixin.ACCESS_TOKEN) {
					setTimeout(function() {
						pushChat(wechatId);
					}, 3000);
				} else {
					pushChat(wechatId);
				}
			}
		});
	});	

	function pushChat(wechatId) {
		weixin.pushTextMsg(wechatId, formatted_message, function() {
			msgRef.child("read_by_"+wechatId).set(true, function() {
				console.log("...and marked as read by " + wechatId);
			});
		});
	}
});


// initiate response to wechat post request (text, img, event etc)
app.post('/', function(req, res) {
    weixin.loop(req, res);
});

// start the server
var port = Number(process.env.PORT || 5000);
app.listen(port, function() {
  console.log("Listening on " + port);
});