import { Hono } from 'hono';
const app = new Hono();

import result from '../model/result';
import { cors } from 'hono/cors';

app.use('*', cors());

app.onError((err, c) => {
	const msg = String(err?.message || '');

	if (err.name === 'BizError') {
		console.log(msg);
	} else {
		console.error(err);
	}

	if (msg === `Cannot read properties of undefined (reading 'get')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (msg === `Cannot read properties of undefined (reading 'put')`) {
		return c.json(result.fail('KV数据库未绑定 KV database not bound',502));
	}

	if (msg === `Cannot read properties of undefined (reading 'prepare')`) {
		return c.json(result.fail('D1数据库未绑定 D1 database not bound',502));
	}

	if (/\.env\.kv\.\w+ is not a function/.test(msg)) {
		return c.json(result.fail('KV数据库未绑定或被同名变量覆盖 KV database not bound/overridden',502));
	}

	if (/\.env\.db\.\w+ is not a function/.test(msg)) {
		return c.json(result.fail('D1数据库未绑定或被同名变量覆盖 D1 database not bound/overridden',502));
	}

	return c.json(result.fail(msg, err.code));
});

export default app;


