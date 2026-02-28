package com.englishapp.service;

import com.englishapp.model.UserAccount;
import com.englishapp.repository.UserAccountRepository;
import com.englishapp.security.AuthUserPrincipal;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {
    private final UserAccountRepository userAccountRepository;

    public CurrentUserService(UserAccountRepository userAccountRepository) {
        this.userAccountRepository = userAccountRepository;
    }

    public Long getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthUserPrincipal principal)) {
            throw new SecurityException("Unauthorized");
        }
        return principal.getId();
    }

    public UserAccount getCurrentUser() {
        Long userId = getCurrentUserId();
        return userAccountRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
    }
}
