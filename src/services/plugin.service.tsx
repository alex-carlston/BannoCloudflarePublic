// Actual plugin rendering service inside Banno

import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { Bindings } from '../services/auth.service'
import { SessionService } from '../services/session.service'
import { handleOAuthCallback } from '../utils/auth'
import type { Context } from 'hono'
import type { Variables } from '../types'

export async function renderPlugin(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const error_description = c.req.query('error_description')

  // Handle OAuth callback if params present
  if (code || error) {
    if (error) return c.text(`Authentication Error: ${error_description || error}`, 400)
    if (!code) return c.redirect('/auth/login')

    try {
      await handleOAuthCallback(c)
    } catch (error: any) {
      return c.text('Error during authentication: ' + error.message, 500)
    }
  }

  // Retrieve signed session cookie
  const sessionId = await getSignedCookie(c, c.env.SESSION_ENC_SECRET!, '__Secure-session_id')

  if (!sessionId) {
    return c.redirect('/auth/login')
  }

  try {
    // Retrieve session from KV
    if (!c.env.SESSIONS_KV) {
      throw new Error('KV namespace not available')
    }

    const sessionService = new SessionService(c.env.SESSIONS_KV, c.env.SESSION_ENC_SECRET!, c.env)
    const session = await sessionService.getSession(sessionId)

    if (!session) {
      // Invalid or expired session
      deleteCookie(c, '__Secure-session_id', {
        secure: true,
        path: '/'
      })
      return c.redirect('/auth/login')
    }

    // Fetch user info from Banno API
    let userInfo: any = null
    let userFetchError: string = ''
    try {
      const baseUrl = c.env.ENV_URI.replace(/\/$/, '')
      const userUrl = `${baseUrl}/a/consumer/api/v0/users/${session.userId}`
      console.log('Fetching user info from:', userUrl)
      
      const userRes = await fetch(userUrl, {
        headers: { 'Authorization': `Bearer ${session.accessToken}` }
      })
      
      console.log('User API response status:', userRes.status)
      
      if (userRes.ok) {
        userInfo = await userRes.json()
        console.log('User info received:', JSON.stringify(userInfo))
      } else {
        const errorText = await userRes.text()
        console.error('User API error:', userRes.status, errorText)
        userFetchError = `API returned ${userRes.status}`
      }
    } catch (err: any) {
      console.error('Failed to fetch user info:', err.message || err)
      userFetchError = err.message || 'Unknown error'
    }

    // Fetch user accounts from Banno API
    let accounts: any[] = []
    let fetchError: string = ''
    try {
      const baseUrl = c.env.ENV_URI.replace(/\/$/, '')
      const accountsUrl = `${baseUrl}/a/consumer/api/v0/users/${session.userId}/accounts`
      console.log('Fetching accounts from:', accountsUrl)
      
      const accountsRes = await fetch(accountsUrl, {
        headers: { 'Authorization': `Bearer ${session.accessToken}` }
      })
      
      console.log('Accounts API response status:', accountsRes.status)
      
      if (accountsRes.ok) {
        const data = await accountsRes.json() as any
        console.log('Accounts data received:', JSON.stringify(data))
        accounts = Array.isArray(data) ? data : (data.accounts || [])
      } else {
        const errorText = await accountsRes.text()
        console.error('Accounts API error:', accountsRes.status, errorText)
        fetchError = `API returned ${accountsRes.status}`
      }
    } catch (err: any) {
      console.error('Failed to fetch accounts:', err.message || err)
      fetchError = err.message || 'Unknown error'
    }

    return c.render(
      <div className="container-fluid px-2">
        <div className="row g-2">

          {/* User Info Card */}
          <div className="col-12">
            <div className="card">
              <div className="card-header bg-primary text-white py-2">
                <h5 className="mb-0 fs-6">
                  <i className="bi bi-person-circle me-2"></i>
                  Welcome, {userInfo?.firstName} {userInfo?.lastName}!
                </h5>
              </div>
              <div className="card-body py-2">
                <div className="row">
                  <div className="col-md-6 col-lg-4">
                    <p className="mb-1 small"><strong>Email:</strong> {userInfo?.email}</p>
                    <p className="mb-1 small"><strong>Username:</strong> {userInfo?.username}</p>
                  </div>
                </div>
                {userFetchError && (
                  <div className="alert alert-warning mt-2 py-1">
                    <small>⚠️ Could not fetch user info (403 Forbidden). </small>
                  </div>
                )}
              </div>
            </div>

            {/* Account Summary Card */}
            <div className="card mb-2">
              <div className="card-header bg-success text-white py-2">
                <h5 className="mb-0 fs-6">
                  <i className="bi bi-pie-chart me-2"></i>
                  Account Summary
                </h5>
              </div>
              <div className="card-body py-2">
                <div className="row text-center">
                  <div className="col-3">
                    <h4 className="text-success mb-0">{accounts.length}</h4>
                    <small className="text-muted">Accounts</small>
                  </div>
                  <div className="col-5">
                    <h4 className="text-success mb-0">${accounts.reduce((sum: number, acc: any) => sum + parseFloat(acc.balance || 0), 0).toLocaleString()}</h4>
                    <small className="text-muted">Total Balance</small>
                  </div>
                  <div className="col-4">
                    <h4 className="text-success mb-0">{accounts.filter((acc: any) => acc.accountSubType === 'Savings').length}</h4>
                    <small className="text-muted">Savings</small>
                  </div>
                </div>
              </div>
            </div>

            {/* Accounts Section */}
            <div className="card">
              <div className="card-header bg-info text-white py-2">
                <h5 className="mb-0 fs-6">
                  <i className="bi bi-bank me-2"></i>
                  Your Accounts
                </h5>
              </div>
              <div className="card-body py-2">
                {accounts.length > 0 ? (
                  <div className="row g-2">
                    {accounts.map((account: any) => (
                      <div key={account.id} className="col-lg-6 col-12">
                        <div className="card h-100 border-primary">
                          <div className="card-header bg-light py-2">
                            <h6 className="mb-0 fs-6">
                              <i className={`bi me-2 ${account.accountSubType === 'Savings' ? 'bi-piggy-bank' : 'bi-credit-card'}`}></i>
                              {account.name.trim()}
                            </h6>
                          </div>
                          <div className="card-body py-2">
                            <div className="row g-1">
                              <div className="col-6">
                                <small className="text-muted d-block">Account #</small>
                                <code className="small">****{account.numbers?.slice(-4)}</code>
                              </div>
                              <div className="col-6">
                                <small className="text-muted d-block">Type</small>
                                <span className="small">{account.accountSubType}</span>
                              </div>
                            </div>
                            <hr className="my-2"/>
                            <div className="row g-1">
                              <div className="col-6">
                                <small className="text-muted d-block">Balance</small>
                                <h6 className="text-success mb-0">${parseFloat(account.balance).toLocaleString()}</h6>
                              </div>
                              <div className="col-6">
                                <small className="text-muted d-block">Available</small>
                                <h6 className="text-primary mb-0">${parseFloat(account.availableBalance).toLocaleString()}</h6>
                              </div>
                            </div>
                            {account.interestRate && (
                              <div className="mt-1">
                                <small className="text-muted">Rate: {parseFloat(account.interestRate).toFixed(2)}%</small>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="alert alert-info mb-0 py-2">
                    <p className="mb-0">No accounts found or unable to fetch accounts from Banno.</p>
                    {fetchError && <p className="mb-0 text-danger"><small>Error: {fetchError}</small></p>}
                    <small className="text-muted">Check browser console for detailed logs.</small>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  } catch (error: any) {
    console.error('Plugin Error:', error)
    return c.text('Error: ' + error.message, 500)
  }
}
