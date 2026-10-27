// Creates only a new, local, disposable test DB and restricted role.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
const admin=new URL(process.env.TEST_ADMIN_DATABASE_URL||'invalid'),relay=new URL(process.env.TEST_DATABASE_URL||'invalid');
const database=admin.pathname.slice(1),role=decodeURIComponent(relay.username);
if(!['127.0.0.1','localhost','[::1]'].includes(admin.hostname)||admin.host!==relay.host||admin.pathname!==relay.pathname||!/^chatgpt_inbox_test_[a-z0-9_]+$/.test(database)||!/^relay_test_[a-z0-9_]+$/.test(role))throw Error('A new loopback test database and restricted test role are required');
admin.pathname='/postgres';
let client=new pg.Client({connectionString:admin.href});await client.connect();
try{
 const password=decodeURIComponent(relay.password).replace(/'/g,"''");
 await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
 await client.query(`CREATE DATABASE ${database}`);
}finally{await client.end();}
admin.pathname='/'+database;client=new pg.Client({connectionString:admin.href});await client.connect();
try{
 await client.query(await readFile(new URL('../relay/sql/001_relay_snapshot.sql',import.meta.url),'utf8'));
 await client.query(`GRANT USAGE ON SCHEMA chatgpt_inbox TO ${role}`);
 await client.query(`GRANT SELECT,INSERT,UPDATE ON chatgpt_inbox.relay_snapshot TO ${role}`);
}finally{await client.end();}
console.log('Prepared disposable PostgreSQL test database with a restricted runtime role.');
