INSERT INTO "UserRoleAssignment" ("userId", role, "createdAt")
SELECT id, 'CLIENT'::"UserRole", CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", role) DO NOTHING;
