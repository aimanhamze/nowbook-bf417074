UPDATE auth.users 
SET encrypted_password = crypt('P@ssw0rd', gen_salt('bf')),
    updated_at = now()
WHERE id = 'b984f2fc-bd36-4982-817c-802196a0e002';