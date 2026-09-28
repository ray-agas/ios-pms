#!/bin/sh
# Runs once, on an empty data volume. Creates the iot-pms database and its own non-superuser role.
# Bobobox AU will get its own database and role the same way (see db/README.md).
set -eu
psql -v ON_ERROR_STOP=1 --username postgres <<SQL
CREATE ROLE iot_pms LOGIN PASSWORD '${IOT_PMS_DB_PASSWORD}';
CREATE DATABASE iot_pms OWNER iot_pms;
REVOKE ALL ON DATABASE iot_pms FROM PUBLIC;
SQL
