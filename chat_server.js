/* Require the packages we will use: */
var http = require("http"),
socketio = require("socket.io"),
fs = require("fs");
 

/* Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html: */
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
 
	fs.readFile("chatroom.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.
 
		if(err) return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);
 

/* Global Vars */
// all chat rooms
var rooms = {};

/* room prototype */
function room(room_name,
			  admin_socket_id,
			  type,
			  password){
	this.room_name = room_name;
	this.admin_socket_id = admin_socket_id;
	this.type = type;
	this.password = password;

	this.users = {};
	this.blacklist = {};
}


// create lobby chatroom
var lobby = new room("lobby", "lobby", "public", "");
rooms.lobby = lobby;



/* Do the Socket.IO magic: */
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
	// This callback runs when a new Socket.IO connection is established.
 	

 	// Confirm connection done to client
	io.sockets.to(socket.id).emit("connected", {user_socket_id: socket.id});
	console.log("new socket.id = " + socket.id);


	// Receive msg from client, broadcast
	socket.on("message_to_server", function(data) {
		

		// Profanity filtering
		var regex = /shit|fucking|bitch|damn|fuck|ass/ig;
 
		var message = data.message.replace( regex, function(s) {
			var i = 0;
			var asterisks = "";
		  	while (i < s.length) {
		    	asterisks += "*";
		    	i++;
		  	}
		 
		  	return asterisks;
		});


		console.log("message: " + message);
		// broadcast the message to other users
		io.sockets.emit("message_to_client",{message: message,
											 username: data.username,
											 room_name: data.room_name });
	});


	// Return a list of users in selected room
	socket.on("cts_update_users_log", function(data) {
		// users from old chatroom
		var old_users, new_users;
		var old_room_name, new_room_name;
		var old_admin_socket_id, new_admin_socket_id;
		// checks if room_name still exists
		if(rooms.hasOwnProperty(data.old_room_name)){
			old_room_name = data.old_room_name;
			old_users = rooms[old_room_name].users;
			old_admin_socket_id = rooms[data.old_room_name].admin_socket_id;
		}
		else{
			old_room_name = "";
			old_users = {};
			old_admin_socket_id = "";
		}
		// users from new chatroom
		if(rooms.hasOwnProperty(data.new_room_name)){
			new_room_name = data.new_room_name;
			new_users = rooms[new_room_name].users;
			new_admin_socket_id = rooms[data.new_room_name].admin_socket_id;
		}
		else{
			new_room_name = "";
			new_users = {};
			new_admin_socket_id = "";
		}

		io.sockets.emit("stc_update_users_log", {old_room_name: old_room_name,
												 new_room_name: new_room_name,
												 old_admin_socket_id: old_admin_socket_id,
												 new_admin_socket_id: new_admin_socket_id,
												 old_users: old_users,
												 new_users: new_users,
												 old_room: rooms[old_room_name],
												 new_room: rooms[new_room_name]});
	});


	// Return a list of chatrooms
	socket.on("cts_update_rooms_log", function(data) {
		io.sockets.emit("stc_update_rooms_log", {rooms: rooms});
	});


	// check if username is on blacklist for target chatroom
	socket.on("cts_validate", function(data) {
		var new_room_name = data.new_room_name;
		var username = data.username;
		var user_socket_id = data.user_socket_id;
		if(rooms[new_room_name].blacklist.hasOwnProperty(user_socket_id)){
			io.sockets.to(socket.id).emit("stc_validate", {new_room_name:new_room_name,
														   join_result:false});
		}else{
			io.sockets.to(socket.id).emit("stc_validate", {new_room_name:new_room_name,
														   join_result:true});
		}
	});


	// Change room, update users list for new chatroom
	socket.on("cts_change_room", function(data) {
		var old_room_name = data.old_room_name;
		var new_room_name = data.new_room_name;
		var user_socket_id = data.user_socket_id;

		// delete user record from current chatroom
		// if room is empty, remove room
		
		if(rooms[old_room_name].users.hasOwnProperty(user_socket_id)){
			delete rooms[old_room_name].users[user_socket_id];
		}
		

		if(Object.keys(rooms[old_room_name].users).length == 0 && data.old_room_name != "lobby"){
			delete rooms[old_room_name];
		}

		
		if(!(user_socket_id in rooms[new_room_name].users)){
			rooms[new_room_name].users[user_socket_id] = data.username;
		}
		io.sockets.to(socket.id).emit("stc_change_room", {new_room_name:new_room_name,
														  old_room_name:old_room_name});
		
	});


	// return the room type of requested chatroom
	socket.on("cts_query_room_type", function(data) {
		var new_room_name = data.new_room_name;
		var type = rooms[new_room_name].type;
		io.sockets.to(socket.id).emit("stc_query_room_type", {new_room_name:new_room_name,
															  type:type});
	});

	// validate private password
	socket.on("cts_validate_password", function(data) {
		var new_room_name = data.new_room_name;
		var private_pwd = data.private_pwd;
		var result;
		if(rooms[new_room_name].password == private_pwd ){
			result = true;
		}else{
			result = false;
		}
		io.sockets.to(socket.id).emit("stc_validate_password", {new_room_name:new_room_name,
																result:result});
	});

	// User disconnects, remove user info
	socket.on("disconnect", function(){
		var old_room_name;
		for(var i in rooms){
			if(socket.id in rooms[i].users){
				old_room_name = i;
				delete rooms[i].users[socket.id];
			}
			if(rooms[i].users.length === 0 && i !== "lobby"){
				delete rooms[i];
			}
		}
		// no new_room_name in this case, since user left chatroom without
		// entering any new chatroom
		io.sockets.emit("stc_disconnect", {old_room_name:old_room_name,
										   new_room_name:old_room_name
		});
	});

	// Create a new chat room
	socket.on("cts_create_new_room", function(data) {
		var room_name = data.new_room_name;
		var admin_socket_id = data.admin_socket_id;
		var username = data.username;
		var type = data.type;
		var password = data.password;
		var new_room = new room(room_name, admin_socket_id, type, password);
		new_room.users[admin_socket_id] = username;
		rooms[room_name] = new_room;
		io.sockets.to(socket.id).emit("stc_create_new_room", {room_name:room_name});
	});



	// Deliver private message
	socket.on("cts_private_message", function(data) {
		var receiver_socket_id = data.receiver_socket_id;
		var receiver_user_name = rooms[data.room_name].users[receiver_socket_id];
		var sender_socket_id = data.user_socket_id;
		io.sockets.to(sender_socket_id).emit("stc_private_message_sender",{message: data.message,
											   						  username: data.username,
											   						  room_name: data.room_name,
											   						  receiver_user_name: receiver_user_name
		});
		io.sockets.to(receiver_socket_id).emit("stc_private_message_receiver",{message: data.message,
											   						  username: data.username,
											   						  room_name: data.room_name
		});
	});


	// kick out a user to lobby
	socket.on("cts_kick", function(data) {
		var kicked_user_socket_id = data.kicked_user_socket_id;
		var room_name = data.room_name;
		var kicked_username = "";

		if(rooms[room_name].users.hasOwnProperty(kicked_user_socket_id)) {
			kicked_username = rooms[room_name].users[kicked_user_socket_id];
		}
		// send to kicked user
		io.sockets.to(kicked_user_socket_id).emit("stc_kick_receiver", {});
		// send to admin
		io.sockets.to(socket.id).emit("stc_kick_sender", {kicked_username : kicked_username});
	});


	// ban a user, add target user to blacklist for current chatroom
	socket.on("cts_ban", function(data) {
		var banned_user_socket_id = data.banned_user_socket_id;
		var room_name = data.room_name;
		var banned_username = "";

		// retrieve banned username
		if(rooms[room_name].users.hasOwnProperty(banned_user_socket_id)) {
			banned_username = rooms[room_name].users[banned_user_socket_id];
		}

		// add target user to blacklist
		rooms[room_name].blacklist[banned_user_socket_id] = banned_username;
		// send to banned user
		io.sockets.to(banned_user_socket_id).emit("stc_ban_receiver", {});
		// send to admin
		io.sockets.to(socket.id).emit("stc_ban_sender", {banned_username : banned_username});
	});

	// unban a user
	socket.on("cts_unban", function(data) {
		var unbanned_user_socket_id = data.unbanned_user_socket_id;
		var room_name = data.room_name;
		var unbanned_username = "";

		// retrieve and delete unbanned username
		if(rooms[room_name].blacklist.hasOwnProperty(unbanned_user_socket_id)) {
			unbanned_username = rooms[room_name].blacklist[unbanned_user_socket_id];
			delete rooms[room_name].blacklist[unbanned_user_socket_id];
		}
		// send to unbanned user
		io.sockets.to(unbanned_user_socket_id).emit("stc_unban_receiver", {room_name:room_name});
		// send to admin
		io.sockets.to(socket.id).emit("stc_unban_sender", {unbanned_username : unbanned_username,
														   room: rooms[room_name]});
	});

});
