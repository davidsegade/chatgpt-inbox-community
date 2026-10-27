import pg from 'pg';
/** PostgreSQL snapshot with an exclusive session lease for one relay process. */
export class PgSnapshotStore {
 constructor(connectionString) {
  if (!connectionString) throw Error('DATABASE_URL required');
  this.pool=new pg.Pool({connectionString,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
  this.client=null;this.connectionFault=false;
 }
 get healthy(){return !!this.client&&!this.connectionFault;}
 async load(){
  if(!this.client){
   const client=await this.pool.connect();
   // A lost session also loses the advisory lock. Never reconnect silently and
   // write a stale snapshot: fail closed until this relay process is restarted.
   client.on('error',()=>{if(this.client===client)this.connectionFault=true;});
   try{
    const lease=await client.query('SELECT pg_try_advisory_lock(1128748098,1) AS acquired');
    if(!lease.rows[0].acquired)throw Object.assign(Error('Another relay owns this database'),{code:'RELAY_LEASE_BUSY'});
    this.client=client;
   }catch(e){client.release(true);throw e;}
  }
  if(this.connectionFault)throw Error('Storage session lost; restart relay');
  const r=await this.client.query('SELECT state FROM chatgpt_inbox.relay_snapshot WHERE id=1');
  return r.rows[0]?.state??null;
 }
 async save(state){
  if(!this.client||this.connectionFault)throw Error('Storage session unavailable; restart relay');
  await this.client.query('INSERT INTO chatgpt_inbox.relay_snapshot(id,state,updated_at) VALUES (1,$1::jsonb,now()) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state,updated_at=EXCLUDED.updated_at',[JSON.stringify(state)]);
 }
 async close(){if(this.client){this.client.release(true);this.client=null;}await this.pool.end();}
}
