const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourcePath,inboxPath}=require('./source.cjs');
test('valid owner and repository',()=>assert.equal(sourcePath('example-user/notes-inbox','main'),'repos/example-user/notes-inbox'));
test('supports branch names',()=>assert.equal(inboxPath('release/v1'),'contents/chatgpt-inbox/requests?ref=release%2Fv1'));
for(const [repo,branch] of [['../repo','main'],['user/.config','main'],['user/repo','../main'],['user/repo','main//test'],['user/repo','main.lock'],['user/repo','main?ref=evil'],['user/repo','']])test('rejects invalid source '+repo+' '+branch,()=>assert.throws(()=>sourcePath(repo,branch)));
