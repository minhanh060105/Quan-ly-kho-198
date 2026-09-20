-- Legacy manual bootstrap replaced by MySQL Shell AdminAPI + InnoDB Cluster.
-- DO NOT set group_replication_bootstrap_group=ON automatically on startup.
-- Follow docs/HUONG_DAN_VAN_HANH_IT.md for initial setup / adoption of an existing group.
-- This file now only inspects the group; it never changes membership or promotes a node.
SELECT MEMBER_ID, MEMBER_HOST, MEMBER_STATE, MEMBER_ROLE
FROM performance_schema.replication_group_members;
SELECT @@global.group_replication_single_primary_mode AS single_primary,
       @@global.group_replication_consistency AS consistency,
       @@global.group_replication_exit_state_action AS exit_action,
       @@global.group_replication_unreachable_majority_timeout AS majority_timeout,
       @@global.super_read_only AS super_read_only;
