var http = require('http');
var parser = require('body-parser');
var cors = require('cors');
var path = require('path');
var {createTerminus} = require('@godaddy/terminus');
var express = require('express');
var ngrok = require('ngrok');
var redis = require('redis');
var cache = require('./model');

require('dotenv').config();

const AgencyServiceClient = require("@streetcred.id/service-clients").AgencyServiceClient;
const Credentials = require("@streetcred.id/service-clients").Credentials;
const client = new AgencyServiceClient(new Credentials(process.env.ACCESSTOK, process.env.SUBKEY));

var app = express();
app.use(cors());
app.use(parser.json());
app.use(express.static(path.join(__dirname, 'build')))

redisClient = redis.createClient();
redisClient.on("error", function (err) {
    console.log("Error " + err);
});

app.get('/ping', function (req, res) {
    return res.send('pong');
});

app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, '/build/index.html'));
});

// WEBHOOK ENDPOINT
app.post('/webhook', async function (req, res) {
    try {
        console.log(req.body);
        if(req.body === null || req.body.data === null)  {
            console.log("request has null values in required params");
            console.log(req.body); 
        }
        if(req.body.message_type === 'new_connection') {
            var params = 
            {
                credentialOfferParameters: 
                {
                    definitionId: process.env.CRED_DEF_ID, 
                    connectionId: req.body.object_id
                }
            }
            await client.createCredential(process.env.TENANT_ID, params)
                .catch(err => console.log(err));            
        }
        else if(req.body.message_type === 'credential_request') {
            const connectionId = req.body.data.ConnectionId;
            var param_obj;
            // redisClient.get(connectionId, async function (err, result) {
                
            // });   
            const attribs = cache.get(connectionId)
            if(attribs){
                console.log("REDIS RES:");
                console.log(attribs);
                param_obj = JSON.parse(attribs);
                const params = {
                    values: {
                        "Full Name": param_obj["name"],
                        "Title": param_obj["title"],
                        "Company Name": param_obj["org"],
                        "Phone Number": param_obj["phone"],
                        "Email": param_obj["email"]
                    }
                }
                await client.issueCredential(req.body.object_id, process.env.TENANT_ID, params);
            } 
            else { 
                console.log("attributes were not formatted correctly.")
            }     
        } 
        else {
            console.log("message type not recognized... yet");
        }
    } 
    catch (e) {
        console.log(e.message || e.toString());
    }
});

//FRONTEND ENDPOINT
app.post('/api/issue', cors(), async function (req, res) {
    const invite = await getInvite();
    const attribs = JSON.stringify(req.body);

    cache.add(invite.connectionId, attribs);
    res.status(200).send({invite_url: invite.invitationUrl});
});


const getInvite = async () => {
    try {
        var result = await client.createConnection(process.env.TENANT_ID, {
            connectionInvitationParameters: {}
        }).catch(err => console.log(err));;
        var invite = await client.getConnection(result.id, process.env.TENANT_ID)
            .catch(err => console.log(err));;
        return invite;

    } catch(e) {
        console.log(e.message || e.toString());
    }
}

// for graceful closing
var server = http.createServer(app);

async function onSignal() {
    var webhookId = cache.get("webhookId");
    console.log("triggered on signal");
    const p1 = await client.removeWebhook(webhookId, process.env.TENANT_ID);
    return Promise.all([p1]);
}
createTerminus(server, {
    signals: ['SIGINT', 'SIGTERM'],
    healthChecks: {},
    onSignal
});

const PORT = process.env.PORT || 3002;
var serve = server.listen(PORT, async function() {
    const url_val = await ngrok.connect(PORT);
    var response = await client.createWebhook(process.env.TENANT_ID, {
        webhookParameters: {
            url: url_val + "/webhook",  // process.env.NGROK_URL
            type: "Notification"
        }
    });
    cache.add("webhookId", response.id);
    console.log('Listening on port %d', server.address().port);
}); 

async function removeWebhooks(tenant_id) {
    var webhooks = await client.listWebhooks(tenant_id);
    console.log(webhooks);
}

