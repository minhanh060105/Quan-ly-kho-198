const password = os.getenv('LAB_DB_PASSWORD');
shell.connect({user:'root',password,host:'db1',port:3306});
let cluster;
try { cluster=dba.getCluster(); } catch (_) {
 cluster=dba.createCluster('visinhLab',{gtidSetIsComplete:true,consistency:'BEFORE_ON_PRIMARY_FAILOVER',exitStateAction:'READ_ONLY',expelTimeout:5});
}
const topology=cluster.status().defaultReplicaSet.topology;
for(const host of ['db2','db3']) {
 if(!topology[host+':3306']) cluster.addInstance({user:'root',password,host,port:3306},{recoveryMethod:'clone',exitStateAction:'READ_ONLY'});
}
print(JSON.stringify(cluster.status()));
