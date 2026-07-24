export { GameRoom } from './room.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I/O/Q — avoids confusion
const code4 = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code.toUpperCase()));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      // POST /api/rooms — create a room
      if (path === '/api/rooms' && request.method === 'POST') {
        for (let i = 0; i < 5; i++) {
          const code = code4();
          const stub = roomStub(env, code);
          const check = await stub.fetch(new Request(`https://do/exists`));
          const { exists } = await check.json<{ exists: boolean }>();
          if (exists) continue;
          await stub.fetch(new Request(`https://do/init?code=${code}`, { method: 'POST' }));
          return Response.json({ code });
        }
        return Response.json({ error: 'could not allocate room' }, { status: 500 });
      }

      // GET /api/rooms/:code — room existence + password pre-check (join validation)
      let m = path.match(/^\/api\/rooms\/([A-Za-z]{4})$/);
      if (m && request.method === 'GET') {
        const check = await roomStub(env, m[1]).fetch(new Request(`https://do/exists${url.search}`));
        return new Response(check.body, { headers: { 'Content-Type': 'application/json' } });
      }

      // GET /api/rooms/:code/ws — websocket into the room's Durable Object
      m = path.match(/^\/api\/rooms\/([A-Za-z]{4})\/ws$/);
      if (m) {
        return roomStub(env, m[1]).fetch(request);
      }

      return Response.json({ error: 'not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
