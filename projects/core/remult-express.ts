import * as express from 'express';

import { createRemultServer } from './server/index';
import { RemultServer, RemultServerImplementation, RemultServerOptions } from './server/expressBridge';
import { Remult, SubServer } from './src/context';
import { AMessageChannel, liveQueryKeepAliveRoute, ServerEventChannelSubscribeDTO, streamUrl } from './src/live-query/LiveQuerySubscriber';
import { LiveQueryPublisher, LiveQueryStorage, LiveQueryStorageInMemoryImplementation, MessagePublisher } from './src/live-query/LiveQueryPublisher';
import { v4 as uuid } from 'uuid';
import { remult } from './src/remult-proxy';
import { getEntityKey } from './src/remult3';


export function remultExpress(options?:
    RemultServerOptions<express.Request> & {
        bodyParser?: boolean;
        bodySizeLimit?: string;
        //TODO - move to remult-server
        subServer?: (router: express.Router, server: RemultServer) => SubServer;
    }): express.RequestHandler & RemultServer {
    let app = express.Router();

    if (!options) {
        options = {};
    }
    if (options.bodySizeLimit === undefined) {
        options.bodySizeLimit = '10mb';
    }
    if (options?.bodyParser !== false) {
        app.use(express.json({ limit: options.bodySizeLimit }));
        app.use(express.urlencoded({ extended: true, limit: options.bodySizeLimit }));
    }

    const server = createRemultServer(options) as RemultServerImplementation;
    server.registerRouter(app);
    if (!options.subServer) {
        options.subServer = (router, server) => {

            return { publisher: buildHttpServerEventDispatcher(router, options.rootPath!, server) };

        }
    }
    app.post(options.rootPath + liveQueryKeepAliveRoute, (r, res, n) => server.withRemult(r, res, n), async (req, res) => {
        res.send(await remult.subServer.storage.keepAliveAndReturnUnknownIds(req.body));

    });
    server.runWithRequest = async (req, entityKey, what) => {

        for (const e of options.entities) {
            let key = getEntityKey(e);
            if (key === entityKey) {
                await new Promise((result) => {
                    server.withRemult(options.requestSerializer!.fromJson(req), undefined, async () => {
                        await what(remult.repo(e));
                        result({});
                    });
                });
                return;
            }
        }
        throw new Error("Couldn't find entity " + entityKey);
    };

    server.subServer = options.subServer(app, server);
    if (!server.subServer.storage) {
        server.subServer.storage = new LiveQueryStorageInMemoryImplementation()
    }

    return Object.assign(app, {
        getRemult: (req) => server.getRemult(req),
        openApiDoc: (options: { title: string }) => server.openApiDoc(options),
        registerRouter: x => server.registerRouter(x),
        withRemult: (...args) => server.withRemult(...args)
    } as RemultServer);

}
export class ServerEventsController implements MessagePublisher {
    subscribeToChannel({ channel, clientId }: ServerEventChannelSubscribeDTO, res: import('express').Response, remult: Remult, remove = false) {
        for (const c of this.connections) {
            if (c.connectionId === clientId) {
                if (this.canUserConnectToChannel(channel, remult)) {
                    if (remove)
                        delete c.channels[channel]
                    else
                        c.channels[channel] = true;
                    res.json("ok");
                    this.debug();
                    return;
                }
                else {
                    res.sendStatus(403);
                    this.debug();
                    return;
                }
            }
        }
        res.sendStatus(404);
    }


    connections: clientConnection[] = [];
    constructor(private canUserConnectToChannel?: (channel: string, remult: Remult) => boolean) {
        if (!this.canUserConnectToChannel) {
            this.canUserConnectToChannel = () => true;
        }
    }


    sendChannelMessage<T>(channel: string, message: any) {
        const data = JSON.stringify({ channel, data: message });

        for (const sc of this.connections) {
            if (sc.channels[channel]) {
                this.debugMessageFileSaver(sc.connectionId, channel, message)
                sc.write(data);
            }
        }
    }
    debugMessageFileSaver = (id, channel, message) => { };


    openHttpServerStream(req: import('express').Request, res: import('express').Response) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        const cc = new clientConnection(res);
        //const lastEventId = req.headers['last-event-id'];

        this.connections.push(cc);
        this.debug();
        req.on("close", () => {
            cc.close();
            this.connections = this.connections.filter(s => s !== cc);
            this.debug();
        });
        return cc;
    }
    debug() {
        this.debugFileSaver(this.connections.map(x => ({
            id: x.connectionId,
            channels: x.channels
        })))
    }
    debugFileSaver: (x: any) => void = () => { };
}
class clientConnection {
    channels: Record<string, boolean> = {};
    close() {
        this.closed = true;
    }
    closed = false;
    write(eventData: string, eventType = "message"): void {
        let event = "event:" + eventType;
        // if (id != undefined)
        //     event += "\nid:" + id;
        this.response.write(event + "\ndata:" + eventData + "\n\n");
        let r = this.response as any as { flush(): void };
        if (r.flush)
            r.flush();
    }
    connectionId = uuid();
    constructor(
        public response: import('express').Response
    ) {
        this.write(this.connectionId, "connectionId");
        this.sendLiveMessage();
    }
    sendLiveMessage() {
        if (this.closed)
            return;
        this.write("", "keep-alive");
        setTimeout(() => {
            this.sendLiveMessage();
        }, 45000);
    }
}

function buildHttpServerEventDispatcher(router: express.Router, apiPath: string, server: RemultServer) {
    const streamPath = apiPath + '/' + streamUrl
    let httpServerEvents = new ServerEventsController();
    router.get(streamPath, (r, res, next) => server.withRemult(r, res, next), (req, res) => {
        (remult.subServer.publisher as ServerEventsController).openHttpServerStream(req, res);
    });
    router.post(streamPath + '/subscribe', (r, res, next) => server.withRemult(r, res, next), (req, res) => {
        (remult.subServer.publisher as ServerEventsController).subscribeToChannel(req.body, res, remult);
    });
    router.post(streamPath + '/unsubscribe', (r, res, next) => server.withRemult(r, res, next), (req, res) => {
        (remult.subServer.publisher as ServerEventsController).subscribeToChannel(req.body, res, remult, true);
    });
    return httpServerEvents;
}
